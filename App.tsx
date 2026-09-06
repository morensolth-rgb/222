import React, {useEffect, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import AppsScreen         from './src/screens/AppsScreen';
import FileBrowserScreen  from './src/screens/FileBrowserScreen';
import AfScreen           from './src/screens/AfScreen';
import PlayerPrefsScreen  from './src/screens/PlayerPrefsScreen';
import SaveHunterScreen   from './src/screens/SaveHunterScreen';
import ValueHuntScreen    from './src/screens/ValueHuntScreen';

const Stack = createNativeStackNavigator();

// Survive process death: if Android kills the app in the background,
// reopen on the exact screen the user was on.
const NAV_STATE_KEY = 'nav:state:v1';

export default function App() {
  const [ready, setReady] = useState(false);
  const [initialState, setInitialState] = useState<any>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(NAV_STATE_KEY);
        if (saved) setInitialState(JSON.parse(saved));
      } catch (_) {}
      setReady(true);
    })();
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <NavigationContainer
        initialState={initialState}
        onStateChange={state =>
          AsyncStorage.setItem(NAV_STATE_KEY, JSON.stringify(state)).catch(() => {})
        }>
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
          <Stack.Screen
            name="PlayerPrefs"
            component={PlayerPrefsScreen}
            options={({route}: any) => ({
              title: route.params?.appName ?? 'PlayerPrefs',
              headerBackTitle: 'Apps',
            })}
          />
          <Stack.Screen
            name="SaveHunter"
            component={SaveHunterScreen}
            options={{headerBackTitle: 'Apps'}}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
