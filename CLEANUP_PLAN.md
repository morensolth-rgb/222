# خطة التنضيف — Apex Ads (قائمة الألعاب + AF_INSTALLATION)

## الهدف
تطبيق واحد: قائمة الألعاب/التطبيقات المثبتة → كبسة → تعرض AF_INSTALLATION
من /data/data/<pkg>/shared_prefs/appsflyer-data.xml عبر root. الاسم: Apex Ads.

## حالة التنفيذ
- [x] App.tsx — إعادة بناء (شيل License/Splash/6 tabs؛ بقا AppsList + AfInstall + FileBrowser)
- [x] حذف الشاشات الزيادة (Home/Script/Console/Analyzer/License/Community/Patcher)
- [x] إضافة src/screens/AfScreen.tsx (تعرض AF_INSTALLATION + raw)
- [x] تعديل AppsScreen: كبسة → openAf (AfInstall)؛ long-press → FileBrowser
- [x] تنضيف RootBridgeModule.kt (شيل frida/download/overlay/script/repack؛
      أبقيت checkRoot/execShell/getInstalledApps/getAppIcon/detectSdks/readDir/readFile/writeFile
      + getAfInstallation الجديدة)
- [x] حذف DownloadService/FloatingLogService/RepackModule/RepackPackage.kt
- [x] تنضيف MainApplication.kt (شيل RepackPackage)
- [x] تنضيف AndroidManifest (شيل services + FOREGROUND_SERVICE*/SYSTEM_ALERT_WINDOW)
- [x] تنضيف build.gradle (شيل aaptOptions frida/apktool/uber-signer + commons-compress/xz/libsu-service)
- [x] تحديث RootBridge.ts (بس الدوال المستخدمة + AfResult)
- [x] إعادة تسمية التطبيق Apex Ads (strings.xml, app.json, MainActivity, settings.gradle, package.json)
- [ ] اختبار البناء (TypeScript + Gradle) — بلوكيد: مافي Android SDK/JDK بالساندبوكس
- [ ] commit + push

## تحقق مرجعي
- NO_DANGLING_REFS (شاشات) ✓
- NO_DANGLING_REFS_KOTLIN (services/repack) ✓

## ملاحظات
- getAfInstallation: بيقرأ الملف عبر cp إلى filesDir كـ root، بيستخرج
  <string name="AF_INSTALLATION">value</string>، ولو ما لقاه بيجرّب regex على timestamp-id.
- license flow اتشال بالكامل — التطبيق بيفتح main مباشرة.
- AsyncStorage: لسا مستخدم بس لحفظ selectedApp (آخر تطبيق مكبوس) — مش ضروري بس ما بيضر.
