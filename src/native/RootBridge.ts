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

export const rootBridge = {
  checkRoot:        (): Promise<boolean>   => RootBridge.checkRoot(),
  execShell:        (cmd: string): Promise<string> => RootBridge.execShell(cmd),
  getInstalledApps: (): Promise<AppInfo[]> => RootBridge.getInstalledApps(),
  getAppIcon:       (packageName: string): Promise<string | null> => RootBridge.getAppIcon(packageName),
  detectSdks:       (): Promise<Record<string, string>> => RootBridge.detectSdks(),
  getAfInstallation:(packageName: string): Promise<AfResult> => RootBridge.getAfInstallation(packageName),
  readDir:          (path: string): Promise<FileEntry[]> => RootBridge.readDir(path),
  readFile:         (path: string): Promise<string>      => RootBridge.readFile(path),
  writeFile:        (path: string, content: string): Promise<string> => RootBridge.writeFile(path, content),
};

export interface FileEntry {
  name:  string;
  path:  string;
  isDir: boolean;
  size:  string;
  perms: string;
}
