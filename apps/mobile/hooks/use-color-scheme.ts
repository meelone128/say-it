import { useColorScheme as useReactNativeColorScheme } from 'react-native';

export type AppColorScheme = 'light' | 'dark';

export function useColorScheme(): AppColorScheme {
  return useReactNativeColorScheme() === 'dark' ? 'dark' : 'light';
}
