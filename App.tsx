import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { LocationObject } from 'expo-location';

import MapScreen from './components/MapScreen';
import LoadingScreen from './components/LoadingScreen';
import PermissionDenied from './components/PermissionDenied';

// #region agent log
const debugLog = (location: string, message: string, data: object, hypothesisId: string) => {
  fetch('http://127.0.0.1:7242/ingest/0595a1ca-db13-40a1-91db-65b59f7fff34',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location,message,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId})}).catch(()=>{});
};
// #endregion

type AppState = 'loading' | 'granted' | 'denied';

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [location, setLocation] = useState<LocationObject | null>(null);

  // #region agent log
  useEffect(() => {
    debugLog('App.tsx:init', 'App component mounted', { appState }, 'D');
  }, []);
  // #endregion

  const requestLocationPermission = async () => {
    // #region agent log
    debugLog('App.tsx:requestLocationPermission', 'Starting permission request', {}, 'C');
    // #endregion
    setAppState('loading');
    
    try {
      // Request foreground location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      // #region agent log
      debugLog('App.tsx:permissionResult', 'Permission result received', { status }, 'C');
      // #endregion
      
      if (status !== 'granted') {
        setAppState('denied');
        return;
      }

      // Get current location
      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      // #region agent log
      debugLog('App.tsx:locationResult', 'Location received', { lat: currentLocation.coords.latitude, lng: currentLocation.coords.longitude }, 'E');
      // #endregion
      
      setLocation(currentLocation);
      setAppState('granted');
    } catch (error) {
      // #region agent log
      debugLog('App.tsx:error', 'Error in requestLocationPermission', { error: String(error) }, 'C');
      // #endregion
      console.error('Error getting location:', error);
      setAppState('denied');
    }
  };

  useEffect(() => {
    requestLocationPermission();
  }, []);

  // Render based on app state
  if (appState === 'loading') {
    return (
      <>
        <LoadingScreen />
        <StatusBar style="light" />
      </>
    );
  }

  if (appState === 'denied') {
    return (
      <>
        <PermissionDenied onRetry={requestLocationPermission} />
        <StatusBar style="light" />
      </>
    );
  }

  if (appState === 'granted' && location) {
    return (
      <>
        <MapScreen location={location} />
        <StatusBar style="auto" />
      </>
    );
  }

  // Fallback (shouldn't reach here)
  return <LoadingScreen />;
}
