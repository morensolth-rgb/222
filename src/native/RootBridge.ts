import {NativeModules} from 'react-native';

const {RootBridge} = NativeModules;

export interface AppInfo {
  packageName: string;
  appName: string;
  isSystemApp: boolean;
}

export interface AfResult {
  found: boolean;
  value?: string;
  raw?: string;
  message?: string;
}

export interface AdidResult {
  found: boolean;
  value?: string;
  message?: string;
}

export interface SingularIds {
  aifa?: string | null;
  installId?: string | null;
}

export interface AppSdkInfo {
  appsflyer: boolean;
  singular: boolean;
  adjust: boolean;
  branch?: boolean;
  files: string[];
}

export const rootBridge = {
  checkRoot:        (): Promise<boolean>   => RootBridge.checkRoot(),
  diagnose:         (packageName: string): Promise<string> => RootBridge.diagnose(packageName),
  execShell:        (cmd: string): Promise<string> => RootBridge.execShell(cmd),
  getInstalledApps: (): Promise<AppInfo[]> => RootBridge.getInstalledApps(),
  getAppIcon:       (packageName: string): Promise<string | null> => RootBridge.getAppIcon(packageName),
  detectSdks:       (): Promise<Record<string, string>> => RootBridge.detectSdks(),
  getAfInstallation:(packageName: string): Promise<AfResult> => RootBridge.getAfInstallation(packageName),
  getAdvertisingId: (): Promise<AdidResult> => RootBridge.getAdvertisingId(),
  getSingularIds:   (packageName: string): Promise<SingularIds> => RootBridge.getSingularIds(packageName),
  detectAppSdk:     (packageName: string): Promise<AppSdkInfo> => RootBridge.detectAppSdk(packageName),
  readDir:          (path: string): Promise<FileEntry[]> => RootBridge.readDir(path),
  readFile:         (path: string): Promise<string>      => RootBridge.readFile(path),
  writeFile:        (path: string, content: string): Promise<string> => RootBridge.writeFile(path, content),
  scanSaves:        (packageName: string): Promise<SaveCandidate[]> => RootBridge.scanSaves(packageName),
  snapshot:         (packageName: string): Promise<string> => RootBridge.snapshot(packageName),
  valueSearch:      (packageName: string, valuesCsv: string): Promise<ValueSearchFile[]> =>
    RootBridge.valueSearch(packageName, valuesCsv),
  valueRefine:      (prevHitsCsv: string, newValue: string): Promise<ValueHit[]> =>
    RootBridge.valueRefine(prevHitsCsv, newValue),
  valueWrite:       (path: string, offset: number, encoding: string, newValue: string): Promise<string> =>
    RootBridge.valueWrite(path, offset, encoding, newValue),
};

export interface ValueHit {
  path: string;
  offset: number;
  encoding: 'ascii' | 'i32' | 'i64' | 'f32' | 'f64';
}

export interface ValueSearchFile {
  path: string;
  size: string;
  /** comma-separated "offset:encoding" pairs across all searched values */
  hits: string;
}

export interface SaveCandidate {
  score: number;
  path:  string;
  size:  string;
  mtime: number; // unix seconds
  kind:  'xml' | 'json' | 'sqlite' | 'bin';
  hits:  number;
}

export interface FileEntry {
  name:  string;
  path:  string;
  isDir: boolean;
  size:  string;
  perms: string;
}
