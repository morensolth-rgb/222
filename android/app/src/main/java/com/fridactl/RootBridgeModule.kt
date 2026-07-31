package com.fridactl

import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Base64
import com.facebook.react.bridge.*
import com.topjohnwu.superuser.Shell
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream

class RootBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "RootBridge"

    companion object {
        init {
            Shell.enableVerboseLogging = false
            Shell.setDefaultBuilder(
                Shell.Builder.create()
                    .setFlags(Shell.FLAG_REDIRECT_STDERR)
                    .setTimeout(60)
            )
        }
    }

    // ─────────────────────────────────────────────
    // Root / shell
    // ─────────────────────────────────────────────

    @ReactMethod
    fun checkRoot(promise: Promise) {
        try {
            val result = Shell.cmd("id").exec()
            promise.resolve(result.out.joinToString("").contains("uid=0"))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun execShell(cmd: String, promise: Promise) {
        Thread {
            try {
                val result = Shell.cmd(cmd).exec()
                val out = result.out.joinToString("\n")
                if (out.isBlank() && result.code != 0) {
                    promise.resolve("ERR:${result.code}")
                } else {
                    promise.resolve(out.ifBlank { "OK" })
                }
            } catch (e: Exception) {
                promise.reject("SHELL_ERROR", e.message)
            }
        }.start()
    }

    // ─────────────────────────────────────────────
    // getInstalledApps — launcher apps (name + icon via PM)
    // Uses ApplicationInfo.flags to classify system/user — NO root needed,
    // so it works on VMOS/emulators where the root shell may be flaky.
    // ─────────────────────────────────────────────
    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        Thread {
            try {
                val pm = reactApplicationContext.packageManager

                val intent = android.content.Intent(android.content.Intent.ACTION_MAIN, null)
                intent.addCategory(android.content.Intent.CATEGORY_LAUNCHER)

                @Suppress("DEPRECATION")
                val activities = pm.queryIntentActivities(intent, 0)

                val arr = WritableNativeArray()
                val seen = HashSet<String>()

                for (ri in activities) {
                    val pkg = ri.activityInfo.packageName
                    if (pkg.isBlank() || !seen.add(pkg)) continue

                    val appName = ri.loadLabel(pm).toString()

                    // Classify via ApplicationInfo flags — no root required
                    val isSystem = try {
                        val ai = pm.getApplicationInfo(pkg, 0)
                        (ai.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0
                    } catch (e: Exception) {
                        false
                    }

                    val map = WritableNativeMap()
                    map.putString("packageName", pkg)
                    map.putString("appName", appName)
                    map.putBoolean("isSystemApp", isSystem)
                    arr.pushMap(map)
                }

                promise.resolve(arr)
            } catch (e: Exception) {
                promise.reject("APPS_ERROR", e.message)
            }
        }.start()
    }

    // ─────────────────────────────────────────────
    // getAppIcon — returns base64 PNG icon via PM
    // ─────────────────────────────────────────────
    @ReactMethod
    fun getAppIcon(packageName: String, promise: Promise) {
        Thread {
            try {
                val pm = reactApplicationContext.packageManager
                val drawable = pm.getApplicationIcon(packageName)
                val bitmap = drawableToBitmap(drawable)
                val stream = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.PNG, 90, stream)
                val b64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                promise.resolve("data:image/png;base64,$b64")
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }.start()
    }

    private fun drawableToBitmap(drawable: Drawable): Bitmap {
        if (drawable is BitmapDrawable && drawable.bitmap != null) {
            return drawable.bitmap
        }
        val w = drawable.intrinsicWidth.takeIf { it > 0 } ?: 96
        val h = drawable.intrinsicHeight.takeIf { it > 0 } ?: 96
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }

    // ─────────────────────────────────────────────
    // detectSdks — scan shared_prefs filenames for known analytics SDKs
    // ─────────────────────────────────────────────
    @ReactMethod
    fun detectSdks(promise: Promise) {
        Thread {
            try {
                // Build the user/third-party set via PackageManager flags — no root,
                // so it stays reliable on VMOS/containers where the root shell may
                // return empty for `pm list packages -3`.
                val thirdParty = thirdPartyPackages()
                val sdkMap = buildSdkMap(thirdParty)
                val result = WritableNativeMap()
                for ((pkg, label) in sdkMap) {
                    result.putString(pkg, label)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.resolve(WritableNativeMap())
            }
        }.start()
    }

    // ─────────────────────────────────────────────
    // detectAppSdk — probe a SINGLE app's shared_prefs and report which
    // tracking SDKs it actually uses. Works per-app (no reliance on
    // `pm list packages -3`), so it's reliable across devices.
    // Returns: { appsflyer: bool, singular: bool, adjust: bool, files: [...] }
    // ─────────────────────────────────────────────
    @ReactMethod
    fun detectAppSdk(packageName: String, promise: Promise) {
        Thread {
            try {
                val dir = "/data/data/$packageName/shared_prefs"
                val out = Shell.cmd("ls '$dir' 2>/dev/null").exec().out
                    .map { it.trim().lowercase() }
                    .filter { it.isNotBlank() }

                val result = WritableNativeMap()
                result.putBoolean("appsflyer", out.any { it.contains("appsflyer") })
                result.putBoolean("singular",  out.any { it.contains("singular") })
                result.putBoolean("adjust",    out.any { it.contains("adjust") })
                result.putBoolean("branch",    out.any { it.contains("branch") })

                val files = Arguments.createArray()
                out.forEach { files.pushString(it) }
                result.putArray("files", files)

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("DETECT_APP_SDK_ERROR", e.message)
            }
        }.start()
    }

    // Third-party (non-system) packages via PackageManager flags — no root.
    private fun thirdPartyPackages(): Set<String> {
        val set = HashSet<String>()
        try {
            val pm = reactApplicationContext.packageManager
            @Suppress("DEPRECATION")
            val pkgs = pm.getInstalledApplications(0)
            for (ai in pkgs) {
                val isSystem = (ai.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0
                val isUpdatedSystem =
                    (ai.flags and android.content.pm.ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
                if (!isSystem || isUpdatedSystem) set.add(ai.packageName)
            }
        } catch (_: Exception) {}
        return set
    }

    private fun buildSdkMap(userPkgs: Set<String>): Map<String, String> {
        val result = mutableMapOf<String, String>()
        try {
            // Prefer iterating the resolved package set and reading each
            // /data/data/<pkg>/shared_prefs directly. On VMOS/containers the
            // glob on /data/data/* often fails (listing the parent dir is
            // blocked even with root), while direct per-package paths work.
            // Fall back to the glob only when PackageManager gave us nothing.
            val cmd = if (userPkgs.isNotEmpty()) {
                val sb = StringBuilder()
                for (pkg in userPkgs) {
                    // package names are [a-zA-Z0-9_.] so no shell escaping needed
                    if (pkg.isBlank()) continue
                    sb.append("ls /data/data/").append(pkg)
                        .append("/shared_prefs 2>/dev/null | while read f; do echo \"")
                        .append(pkg).append(":\$f\"; done; ")
                }
                sb.toString()
            } else {
                "for d in /data/data/*/shared_prefs; do " +
                "pkg=\$(echo \$d | cut -d/ -f4); " +
                "ls \$d 2>/dev/null | while read f; do echo \"\$pkg:\$f\"; done; " +
                "done 2>/dev/null"
            }
            val out = Shell.cmd(cmd).exec().out

            val filesByPkg = mutableMapOf<String, MutableList<String>>()
            for (line in out) {
                val colon = line.indexOf(':')
                if (colon < 1) continue
                val pkg = line.substring(0, colon).trim()
                val file = line.substring(colon + 1).trim().lowercase()
                if (pkg.isBlank() || file.isBlank()) continue
                filesByPkg.getOrPut(pkg) { mutableListOf() }.add(file)
            }

            for ((pkg, files) in filesByPkg) {
                // Skip system apps only when we actually resolved a user set;
                // if it's empty (PM gave nothing) don't filter, so the screen
                // never ends up blank.
                if (userPkgs.isNotEmpty() && !userPkgs.contains(pkg)) continue
                val sdks = mutableListOf<String>()
                if (files.any { it.contains("appsflyer") }) sdks.add("AppsFlyer")
                if (files.any { it.contains("adjust") })    sdks.add("Adjust")
                if (files.any { it.contains("singular") })  sdks.add("Singular")
                if (files.any { it.contains("branch") })    sdks.add("Branch")
                if (files.any { it.contains("kochava") })   sdks.add("Kochava")
                if (files.any { it.contains("tenjin") })    sdks.add("Tenjin")
                if (files.any { it.contains("amplitude") }) sdks.add("Amplitude")
                if (files.any { it.contains("mixpanel") })  sdks.add("Mixpanel")
                if (files.any { it.contains("onesignal") }) sdks.add("OneSignal")
                if (files.any { it.contains("segment") })   sdks.add("Segment")
                if (sdks.isNotEmpty()) result[pkg] = sdks.joinToString(" · ")
            }
        } catch (_: Exception) {}
        return result
    }

    // ─────────────────────────────────────────────
    // getAfInstallation — read AF_INSTALLATION from appsflyer-data.xml via root
    // ─────────────────────────────────────────────
    @ReactMethod
    fun getAfInstallation(packageName: String, promise: Promise) {
        Thread {
            try {
                val path = "/data/data/$packageName/shared_prefs/appsflyer-data.xml"

                // Read the file via root (copy to tmp then read as app user)
                val tmp = "${reactApplicationContext.filesDir}/af_tmp_$packageName"
                val copy = Shell.cmd("cp '$path' '$tmp' && chmod 644 '$tmp' 2>&1").exec()
                val f = File(tmp)

                val result = WritableNativeMap()

                if (!f.exists() || !copy.isSuccess) {
                    result.putBoolean("found", false)
                    result.putString(
                        "message",
                        "appsflyer-data.xml not found. The app may not use AppsFlyer, or it hasn't been opened yet."
                    )
                    promise.resolve(result)
                    return@Thread
                }

                val content = try { f.readText() } catch (e: Exception) { "" }
                f.delete()

                if (content.isBlank()) {
                    result.putBoolean("found", false)
                    result.putString("message", "appsflyer-data.xml is empty.")
                    promise.resolve(result)
                    return@Thread
                }

                // Extract AF_INSTALLATION value — it's stored as:
                //   <string name="AF_INSTALLATION">1785021551207-9064165349037369142</string>
                val value = extractXmlString(content, "AF_INSTALLATION")

                if (value != null) {
                    result.putBoolean("found", true)
                    result.putString("value", value)
                    result.putString("raw", content)
                } else {
                    // Fallback: look for any installation-id-like long key in the file
                    val fallback = Regex("[0-9]{13,}-[0-9]{10,}").find(content)?.value
                    if (fallback != null) {
                        result.putBoolean("found", true)
                        result.putString("value", fallback)
                        result.putString("raw", content)
                    } else {
                        result.putBoolean("found", false)
                        result.putString(
                            "message",
                            "AF_INSTALLATION key not found inside appsflyer-data.xml."
                        )
                        result.putString("raw", content)
                    }
                }

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("AF_ERROR", e.message)
            }
        }.start()
    }

    // ─────────────────────────────────────────────
    // getAdvertisingId — read GAID from Google Play services prefs via root
    // /data/data/com.google.android.gms/shared_prefs/adid_settings.xml -> adid_key
    // ─────────────────────────────────────────────
    @ReactMethod
    fun getAdvertisingId(promise: Promise) {
        Thread {
            try {
                val candidates = listOf(
                    "/data/data/com.google.android.gms/shared_prefs/adid_settings.xml",
                    "/data/data/com.google.android.gms/shared_prefs/adid_settings"
                )
                val tmp = "${reactApplicationContext.filesDir}/adid_tmp"
                var content = ""

                for (path in candidates) {
                    Shell.cmd("cp '$path' '$tmp' && chmod 644 '$tmp' 2>&1").exec()
                    val f = File(tmp)
                    if (f.exists()) {
                        content = try { f.readText() } catch (e: Exception) { "" }
                        f.delete()
                        if (content.isNotBlank()) break
                    }
                }

                val result = WritableNativeMap()

                if (content.isBlank()) {
                    result.putBoolean("found", false)
                    result.putString("message", "Advertising ID not found on this device.")
                    promise.resolve(result)
                    return@Thread
                }

                var value = extractXmlString(content, "adid_key")
                if (value == null) {
                    // Fallback: any UUID-looking string
                    value = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
                        .find(content)?.value
                }

                if (value != null) {
                    result.putBoolean("found", true)
                    result.putString("value", value)
                } else {
                    result.putBoolean("found", false)
                    result.putString("message", "adid_key not found inside adid_settings.")
                }

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("ADID_ERROR", e.message)
            }
        }.start()
    }

    // ─────────────────────────────────────────────
    // getSingularIds — read AIFA + Singular Install ID from the app's prefs via root
    //   AIFA:               /data/data/<pkg>/shared_prefs/singular-licensing-api.xml
    //                       -> first <string name="<uuid>">...</string>  (name IS the AIFA)
    //   Singular Install ID:/data/data/<pkg>/shared_prefs/pref-singular-id.xml
    //                       -> <string name="singular-id">...</string>   (value)
    // ─────────────────────────────────────────────
    @ReactMethod
    fun getSingularIds(packageName: String, promise: Promise) {
        Thread {
            val result = WritableNativeMap()
            val tmp = "${reactApplicationContext.filesDir}/sing_tmp_$packageName"

            // ── AIFA: the key NAME itself is the AIFA uuid ──
            try {
                val path = "/data/data/$packageName/shared_prefs/singular-licensing-api.xml"
                Shell.cmd("cp '$path' '$tmp' && chmod 644 '$tmp' 2>&1").exec()
                val f = File(tmp)
                var aifa: String? = null
                if (f.exists()) {
                    val content = try { f.readText() } catch (e: Exception) { "" }
                    f.delete()
                    // The AIFA is the uuid that appears as the key NAME — regardless of
                    // element type (<boolean name="uuid" .../> or <string name="uuid">..)
                    aifa = Regex("name=\"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\"")
                        .find(content)?.groupValues?.get(1)
                }
                result.putString("aifa", aifa)
            } catch (_: Exception) {
                result.putString("aifa", null)
            }

            // ── Singular Install ID: value of name="singular-id" ──
            try {
                val path = "/data/data/$packageName/shared_prefs/pref-singular-id.xml"
                Shell.cmd("cp '$path' '$tmp' && chmod 644 '$tmp' 2>&1").exec()
                val f = File(tmp)
                var installId: String? = null
                if (f.exists()) {
                    val content = try { f.readText() } catch (e: Exception) { "" }
                    f.delete()
                    installId = extractXmlString(content, "singular-id")
                    if (installId == null) {
                        installId = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
                            .find(content)?.value
                    }
                }
                result.putString("installId", installId)
            } catch (_: Exception) {
                result.putString("installId", null)
            }

            promise.resolve(result)
        }.start()
    }

    // Extract <string name="KEY">value</string> from SharedPreferences XML
    private fun extractXmlString(xml: String, key: String): String? {
        // Standard form
        val rx = Regex(
            "<string\\s+name=\"${Regex.escape(key)}\"[^>]*>([^<]*)</string>",
            RegexOption.IGNORE_CASE
        )
        val m = rx.find(xml) ?: return null
        val v = m.groupValues[1].trim()
        return v.ifBlank { null }
    }

    // ─────────────────────────────────────────────
    // File Browser — root access to /data/data
    // ─────────────────────────────────────────────

    @ReactMethod
    fun readDir(path: String, promise: Promise) {
        Thread {
            try {
                val cmd = "find '$path' -maxdepth 1 -mindepth 1 " +
                    "\\( -type f -o -type d -o -type l \\) " +
                    "-exec stat -c '%F|%s|%A|%n' {} \\; 2>&1"
                val result = Shell.cmd(cmd).exec()

                val arr = WritableNativeArray()
                for (line in result.out) {
                    if (line.isBlank()) continue
                    val parts = line.split("|", limit = 4)
                    if (parts.size < 4) continue
                    val fileType = parts[0]
                    val size     = parts[1].toLongOrNull() ?: 0L
                    val perms    = parts[2]
                    val fullPath = parts[3].trim()
                    val name     = fullPath.substringAfterLast("/")
                    if (name.isEmpty() || name == "." || name == "..") continue
                    val isDir = fileType.contains("directory") || fileType.contains("link")
                    val map = WritableNativeMap()
                    map.putString("name", name)
                    map.putString("path", fullPath)
                    map.putBoolean("isDir", isDir)
                    map.putString("size", if (isDir) "" else formatSize(size))
                    map.putString("perms", perms)
                    arr.pushMap(map)
                }

                if (arr.size() == 0 && result.out.any {
                    it.contains("Permission denied") || it.contains("Operation not permitted")
                }) {
                    promise.reject("READ_DIR_ERROR", "Permission denied (SELinux)")
                    return@Thread
                }

                promise.resolve(arr)
            } catch (e: Exception) {
                promise.reject("READ_DIR_ERROR", e.message)
            }
        }.start()
    }

    @ReactMethod
    fun readFile(path: String, promise: Promise) {
        Thread {
            try {
                val tmp = "${reactApplicationContext.filesDir}/tmpread"
                Shell.cmd("cp '$path' '$tmp' && chmod 644 '$tmp' 2>&1").exec()
                val f = File(tmp)
                if (!f.exists()) throw Exception("Cannot read file")
                val size = f.length()
                if (size > 512 * 1024) {
                    val head = Shell.cmd("xxd '$path' 2>/dev/null | head -32").exec()
                        .out.joinToString("\n")
                    promise.resolve("[Binary file — ${formatSize(size)}]\n\n$head\n...(truncated)")
                } else {
                    val content = f.readText()
                    if (content.contains(' ')) {
                        val hex = Shell.cmd("xxd '$path' 2>/dev/null | head -64").exec()
                            .out.joinToString("\n")
                        promise.resolve("[Binary — ${formatSize(size)}]\n\n$hex")
                    } else {
                        promise.resolve(content)
                    }
                }
                f.delete()
            } catch (e: Exception) {
                promise.reject("READ_FILE_ERROR", e.message)
            }
        }.start()
    }

    @ReactMethod
    fun writeFile(path: String, content: String, promise: Promise) {
        Thread {
            try {
                val tmp = "${reactApplicationContext.filesDir}/tmpwrite"
                File(tmp).writeText(content)
                val r = Shell.cmd("cp '$tmp' '$path' 2>&1").exec()
                File(tmp).delete()
                if (!r.isSuccess && r.out.isNotEmpty()) {
                    promise.reject("WRITE_FILE_ERROR", r.out.joinToString("\n"))
                } else {
                    promise.resolve("OK")
                }
            } catch (e: Exception) {
                promise.reject("WRITE_FILE_ERROR", e.message)
            }
        }.start()
    }

    private fun formatSize(bytes: Long): String = when {
        bytes < 1024       -> "${bytes}B"
        bytes < 1024*1024  -> "${bytes/1024}KB"
        else               -> "${"%.1f".format(bytes/1024.0/1024.0)}MB"
    }
}
