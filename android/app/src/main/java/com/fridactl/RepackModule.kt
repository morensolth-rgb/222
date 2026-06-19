package com.fridactl

import android.content.Context
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.topjohnwu.superuser.Shell
import java.io.*
import java.util.zip.*

class RepackModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "RepackModule"

    // ── helpers ──────────────────────────────────────────────────────────────

    private fun emit(msg: String) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("RepackLog", msg)
        } catch (_: Exception) {}
    }

    private fun log(msg: String) {
        android.util.Log.d("RepackModule", msg)
        emit(msg)
    }

    /** Extracts an asset from the APK bundle to filesDir if not already there */
    private fun extractAsset(name: String): File {
        val dest = File(reactContext.filesDir, name)
        if (!dest.exists() || dest.length() == 0L) {
            reactContext.assets.open(name).use { input ->
                FileOutputStream(dest).use { output -> input.copyTo(output) }
            }
            log("Extracted asset: $name (${dest.length() / 1024}KB)")
        }
        return dest
    }

    /** Run shell command via libsu, stream output to log */
    private fun sh(cmd: String): Pair<Boolean, String> {
        val result = Shell.cmd(cmd).exec()
        val out = (result.out + result.err).joinToString("\n")
        out.lines().forEach { if (it.isNotBlank()) log("  $it") }
        return Pair(result.isSuccess, out)
    }

    /** Run java -jar with JAVA_HOME we bundle or system java */
    private fun java(vararg args: String): Pair<Boolean, String> {
        val javaExe = findJava()
        val cmd = "$javaExe ${args.joinToString(" ")}"
        log("$ $cmd")
        return sh(cmd)
    }

    private fun findJava(): String {
        // Try system java first (rooted device likely has it via termux/system)
        val candidates = listOf(
            "/usr/bin/java",
            "/system/bin/java",
            "/data/data/com.termux/files/usr/bin/java"
        )
        for (c in candidates) {
            if (File(c).exists()) return c
        }
        // Fallback: hope it's in PATH
        return "java"
    }

    /** Copy a file from a zip/apk by entry name */
    private fun extractFromZip(zipPath: String, entryName: String, dest: File) {
        ZipFile(zipPath).use { zip ->
            val entry = zip.getEntry(entryName)
                ?: throw FileNotFoundException("Entry $entryName not found in $zipPath")
            dest.parentFile?.mkdirs()
            zip.getInputStream(entry).use { inp ->
                FileOutputStream(dest).use { out -> inp.copyTo(out) }
            }
        }
    }

    /** List all entries in a zip matching a prefix */
    private fun listZipEntries(zipPath: String, prefix: String): List<String> {
        val result = mutableListOf<String>()
        ZipFile(zipPath).use { zip ->
            val entries = zip.entries()
            while (entries.hasMoreElements()) {
                val e = entries.nextElement()
                if (e.name.startsWith(prefix)) result.add(e.name)
            }
        }
        return result
    }

    // ── Smali injection ───────────────────────────────────────────────────────

    /**
     * Finds the Application class smali (or first Activity) and injects
     *   invoke-static {}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V
     * Actually we use System.loadLibrary via the proper smali sequence.
     */
    private fun injectSmali(decodedDir: File): Boolean {
        val smaliDirs = decodedDir.walkTopDown()
            .filter { it.isDirectory && it.name.startsWith("smali") }
            .toList()

        log("Smali dirs: ${smaliDirs.map { it.name }}")

        // 1. Try to find Application subclass
        var targetFile: File? = null
        var targetClass: String? = null

        for (smaliDir in smaliDirs) {
            smaliDir.walkTopDown().filter { it.extension == "smali" }.forEach { f ->
                val text = f.readText()
                if (text.contains("Landroid/app/Application;") &&
                    text.contains("attachBaseContext") &&
                    !text.contains("loadLibrary") &&
                    targetFile == null) {
                    targetFile = f
                    targetClass = f.nameWithoutExtension
                }
            }
            if (targetFile != null) break
        }

        // 2. Fallback: first Activity with onCreate
        if (targetFile == null) {
            for (smaliDir in smaliDirs) {
                smaliDir.walkTopDown().filter { it.extension == "smali" }.forEach { f ->
                    val text = f.readText()
                    if (text.contains("Landroid/app/Activity;") &&
                        text.contains("onCreate") &&
                        !text.contains("loadLibrary") &&
                        targetFile == null) {
                        targetFile = f
                        targetClass = f.nameWithoutExtension
                    }
                }
                if (targetFile != null) break
            }
        }

        if (targetFile == null) {
            log("WARNING: Could not find Application or Activity class — creating stub smali")
            return injectStubSmali(decodedDir)
        }

        log("Injecting into: ${targetFile!!.name}")
        val injected = injectLoadLibrary(targetFile!!)
        return injected
    }

    private fun injectLoadLibrary(smaliFile: File): Boolean {
        var text = smaliFile.readText()

        // The smali snippet to load fridamod:
        val loadSnippet = """
    const-string v0, "fridamod"
    invoke-static {v0}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V
""".trimIndent()

        // Try to inject at start of attachBaseContext or onCreate
        val methodPatterns = listOf(
            "attachBaseContext(Landroid/content/Context;)V",
            "onCreate()V",
            "onCreate(Landroid/os/Bundle;)V"
        )

        for (pattern in methodPatterns) {
            val methodIdx = text.indexOf(".method public $pattern")
            if (methodIdx == -1) continue

            // Find the first .locals or first instruction after .method
            val afterMethod = text.indexOf("\n", methodIdx) + 1
            val localsIdx = text.indexOf(".locals", afterMethod)
            val endLocals = if (localsIdx != -1) text.indexOf("\n", localsIdx) + 1 else afterMethod

            // Bump .locals count if needed
            if (localsIdx != -1 && localsIdx < afterMethod + 200) {
                val localsLine = text.substring(localsIdx, text.indexOf("\n", localsIdx))
                val currentLocals = localsLine.trim().removePrefix(".locals").trim().toIntOrNull() ?: 1
                if (currentLocals < 1) {
                    text = text.replace(localsLine, "    .locals 1")
                }
            } else {
                // No .locals line — add one
                text = text.substring(0, afterMethod) + "    .locals 1\n" + text.substring(afterMethod)
            }

            // Inject after .locals
            val insertAt = if (localsIdx != -1) {
                val newLocalsEnd = text.indexOf("\n", text.indexOf(".locals", afterMethod)) + 1
                newLocalsEnd
            } else {
                afterMethod
            }

            text = text.substring(0, insertAt) + "\n    $loadSnippet\n" + text.substring(insertAt)
            smaliFile.writeText(text)
            log("Injected loadLibrary(\"fridamod\") into ${smaliFile.name}::$pattern")
            return true
        }

        log("WARNING: No suitable method found in ${smaliFile.name}, trying stub approach")
        return injectStubSmali(smaliFile.parentFile!!)
    }

    /** Create a new smali Application class that just loads the library */
    private fun injectStubSmali(smaliDir: File): Boolean {
        // Find the first smali dir
        val targetDir = smaliDir.walkTopDown()
            .firstOrNull { it.isDirectory && it.name.startsWith("smali") }
            ?: return false

        val stubFile = File(targetDir, "com/fridamod/inject/FridaModApp.smali")
        stubFile.parentFile?.mkdirs()

        stubFile.writeText("""
.class public Lcom/fridamod/inject/FridaModApp;
.super Landroid/app/Application;

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Landroid/app/Application;-><init>()V
    return-void
.end method

.method public attachBaseContext(Landroid/content/Context;)V
    .locals 1
    invoke-super {p0, p1}, Landroid/app/Application;->attachBaseContext(Landroid/content/Context;)V
    const-string v0, "fridamod"
    invoke-static {v0}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V
    return-void
.end method
""".trimIndent())

        // Patch AndroidManifest.xml to use our Application
        val manifest = File(smaliDir.parent ?: return false, "AndroidManifest.xml")
        if (manifest.exists()) {
            var manifestText = manifest.readText()
            if (manifestText.contains("android:name=")) {
                // Already has application name — patch it
                manifestText = manifestText.replace(
                    Regex("android:name=\"[^\"]*\""),
                    "android:name=\"com.fridamod.inject.FridaModApp\""
                )
            } else {
                manifestText = manifestText.replace(
                    "<application",
                    "<application android:name=\"com.fridamod.inject.FridaModApp\""
                )
            }
            manifest.writeText(manifestText)
            log("Patched AndroidManifest.xml to use FridaModApp")
        }

        log("Created stub FridaModApp.smali")
        return true
    }

    // ── JSCore DEX merge ──────────────────────────────────────────────────────

    /**
     * Merges jscore classes from jshook's classes.dex into the decoded APK.
     * Strategy: copy jshook classes.dex as classes2.dex (multidex).
     * Also patches smali to add multidex support if needed.
     */
    private fun mergeJscoreDex(jshookApkPath: String, decodedDir: File) {
        log("Merging jscore DEX from jshook...")
        val dexDest = File(decodedDir, "classes2.dex")

        try {
            extractFromZip(jshookApkPath, "classes.dex", dexDest)
            log("Copied jshook classes.dex → classes2.dex (${dexDest.length() / 1024}KB)")
        } catch (e: Exception) {
            log("WARNING: Could not extract jscore dex: ${e.message}")
        }
    }

    // ── Main repack pipeline ──────────────────────────────────────────────────

    @ReactMethod
    fun repackApk(
        apkPath: String,
        jshookApkPath: String,
        libfridamodPath: String,
        promise: Promise
    ) {
        Thread {
            try {
                log("=== FridaCtl Repack Started ===")
                log("Target APK: $apkPath")

                val workDir = File(reactContext.cacheDir, "repack_${System.currentTimeMillis()}")
                workDir.mkdirs()
                log("Work dir: ${workDir.absolutePath}")

                // 1. Extract tools
                log("\n[1/7] Extracting tools...")
                val apktoolJar = extractAsset("apktool.jar")
                val signerJar  = extractAsset("uber-signer.jar")

                // 2. Decode APK
                log("\n[2/7] Decoding APK with apktool...")
                val decodedDir = File(workDir, "decoded")
                val (decodeOk, decodeOut) = java(
                    "-jar", apktoolJar.absolutePath,
                    "d", "\"$apkPath\"",
                    "-o", "\"${decodedDir.absolutePath}\"",
                    "--force",
                    "-q"
                )
                if (!decodeOk) {
                    promise.reject("DECODE_FAILED", "apktool decode failed:\n$decodeOut")
                    return@Thread
                }
                log("Decoded to: ${decodedDir.absolutePath}")

                // 3. Copy libfridamod.so
                log("\n[3/7] Copying libfridamod.so...")
                val libDir = File(decodedDir, "lib/arm64-v8a")
                libDir.mkdirs()
                File(libfridamodPath).copyTo(File(libDir, "libfridamod.so"), overwrite = true)
                log("libfridamod.so → ${libDir.absolutePath}/libfridamod.so")

                // Also ensure x86_64 / armeabi-v7a dirs don't break (optional stubs)
                // We only target arm64 for now

                // 4. Inject smali
                log("\n[4/7] Injecting smali (System.loadLibrary)...")
                injectSmali(decodedDir)

                // 5. Merge jscore DEX
                log("\n[5/7] Merging jscore DEX...")
                mergeJscoreDex(jshookApkPath, decodedDir)

                // 6. Rebuild APK
                log("\n[6/7] Rebuilding APK with apktool...")
                val patchedUnsigned = File(workDir, "patched_unsigned.apk")
                val (buildOk, buildOut) = java(
                    "-jar", apktoolJar.absolutePath,
                    "b", "\"${decodedDir.absolutePath}\"",
                    "-o", "\"${patchedUnsigned.absolutePath}\"",
                    "-q"
                )
                if (!buildOk) {
                    promise.reject("BUILD_FAILED", "apktool build failed:\n$buildOut")
                    return@Thread
                }
                log("Built: ${patchedUnsigned.absolutePath} (${patchedUnsigned.length() / 1024}KB)")

                // 7. Sign APK
                log("\n[7/7] Signing APK...")
                val patchedSigned = File(workDir, "patched_signed.apk")
                val (signOk, signOut) = java(
                    "-jar", signerJar.absolutePath,
                    "--apks", "\"${patchedUnsigned.absolutePath}\"",
                    "--out", "\"${workDir.absolutePath}\"",
                    "--allowResign",
                    "--overwrite"
                )

                // uber-signer adds suffix — find the output
                val signedFile = workDir.listFiles()
                    ?.firstOrNull { it.name.endsWith("-aligned-debugSigned.apk") }
                    ?: workDir.listFiles()?.firstOrNull { it.name.endsWith(".apk") && it != patchedUnsigned }

                if (signedFile == null) {
                    log("WARNING: Could not find signed APK, using unsigned")
                    promise.resolve(patchedUnsigned.absolutePath)
                    return@Thread
                }

                // Move to final location
                val finalApk = File(reactContext.getExternalFilesDir(null), "patched_${System.currentTimeMillis()}.apk")
                signedFile.copyTo(finalApk, overwrite = true)

                log("\n=== DONE ===")
                log("Output: ${finalApk.absolutePath}")
                log("Size: ${finalApk.length() / 1024 / 1024}MB")

                promise.resolve(finalApk.absolutePath)

            } catch (e: Exception) {
                log("ERROR: ${e.message}")
                promise.reject("REPACK_ERROR", e.message ?: "Unknown error", e)
            }
        }.start()
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
