import React, { useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { LocationObject } from 'expo-location';

// #region agent log
const debugLog = (location: string, message: string, data: object, hypothesisId: string) => {
  fetch('http://127.0.0.1:7242/ingest/0595a1ca-db13-40a1-91db-65b59f7fff34',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location,message,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId})}).catch(()=>{});
};
// #endregion

interface MapScreenProps {
  location: LocationObject;
}

export default function MapScreen({ location }: MapScreenProps) {
  // #region agent log
  useEffect(() => {
    debugLog('MapScreen.web.tsx:mount', 'MapScreen (web) mounted', { lat: location?.coords?.latitude, lng: location?.coords?.longitude }, 'A');
  }, []);
  // #endregion

  const handleAddMemory = () => {
    // #region agent log
    debugLog('MapScreen.web.tsx:addMemory', 'Add memory button pressed', { lat: location.coords.latitude, lng: location.coords.longitude }, 'A');
    // #endregion
    console.log('📍 Adding memory at:', {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    });
  };

  // #region agent log
  debugLog('MapScreen.web.tsx:render', 'MapScreen (web) rendering', { platform: 'web' }, 'B');
  // #endregion

  return (
    <View style={styles.container}>
      <View style={styles.webMapPlaceholder}>
        <Text style={styles.webMapIcon}>🗺️</Text>
        <Text style={styles.webMapTitle}>Memory Delivery</Text>
        <Text style={styles.webMapText}>현재 위치</Text>
        <Text style={styles.webMapCoords}>
          위도: {location.coords.latitude.toFixed(6)}
        </Text>
        <Text style={styles.webMapCoords}>
          경도: {location.coords.longitude.toFixed(6)}
        </Text>
        <Text style={styles.webMapNote}>
          📱 모바일 기기에서 전체 지도 기능을 이용하세요
        </Text>
      </View>
      
      {/* Add Memory Button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.addButton} onPress={handleAddMemory}>
          <Text style={styles.addButtonIcon}>+</Text>
          <Text style={styles.addButtonText}>Leave a Note Here</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webMapPlaceholder: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  webMapIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  webMapTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 30,
    letterSpacing: 1,
  },
  webMapText: {
    fontSize: 18,
    color: '#a0a0a0',
    marginBottom: 12,
  },
  webMapCoords: {
    fontSize: 16,
    color: '#6366f1',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  webMapNote: {
    fontSize: 14,
    color: '#888888',
    marginTop: 40,
    textAlign: 'center',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  addButtonIcon: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginRight: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});

