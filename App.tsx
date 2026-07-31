import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import AppsScreen        from './src/screens/AppsScreen';
import FileBrowserScreen from './src/screens/FileBrowserScreen';
import AfScreen          from './src/screens/AfScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: {backgroundColor: '#0d0d0d'},
            headerTintColor: '#00ff88',
            headerTitleStyle: {fontFamily: 'monospace', fontWeight: 'bold'},
            contentStyle: {backgroundColor: '#0d0d0d'},
          }}>
          <Stack.Screen
            name="AppsList"
            component={AppsScreen}
            options={{title: 'Apex Ads', headerShown: false}}
          />
          <Stack.Screen
            name="AfInstall"
            component={AfScreen}
            options={({route}: any) => ({
              title: route.params?.appName ?? 'AF Installation',
            })}
          />
          <Stack.Screen
            name="FileBrowser"
            component={FileBrowserScreen}
            options={({route}: any) => ({
              title: route.params?.title ?? 'Files',
              headerBackTitle: 'Apps',
            })}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
