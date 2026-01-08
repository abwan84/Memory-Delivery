import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Platform } from 'react-native';
import { LocationObject } from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

// #region agent log
const debugLog = (location: string, message: string, data: object, hypothesisId: string) => {
  fetch('http://127.0.0.1:7242/ingest/0595a1ca-db13-40a1-91db-65b59f7fff34',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location,message,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId})}).catch(()=>{});
};
// #endregion

// Memory 데이터 타입 정의
interface Memory {
  id: string;
  text: string;
  latitude: number;
  longitude: number;
  date: string;
}

const STORAGE_KEY = '@memories';

interface MapScreenProps {
  location: LocationObject;
}

export default function MapScreen({ location }: MapScreenProps) {
  const [memoryText, setMemoryText] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [saveMessage, setSaveMessage] = useState('');

  // #region agent log
  useEffect(() => {
    debugLog('MapScreen.web.tsx:mount', 'MapScreen (web) mounted', { lat: location?.coords?.latitude, lng: location?.coords?.longitude }, 'A');
  }, []);
  // #endregion

  // 앱 시작시 저장된 메모리 불러오기
  useEffect(() => {
    loadMemories();
  }, []);

  // AsyncStorage에서 메모리 목록 불러오기
  const loadMemories = async () => {
    try {
      const storedMemories = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedMemories) {
        setMemories(JSON.parse(storedMemories));
      }
    } catch (error) {
      console.error('메모리 불러오기 실패:', error);
    }
  };

  // 메모리 저장하기
  const handleSaveMemory = async () => {
    // 1. 위치 데이터 확인
    if (!location || !location.coords) {
      showMessage('❌ 위치 정보를 찾을 수 없습니다.');
      return;
    }

    // 텍스트가 비어있는지 확인
    if (!memoryText.trim()) {
      showMessage('✏️ 메모리 내용을 입력해주세요.');
      return;
    }

    try {
      // 2. 메모리 객체 생성
      const newMemory: Memory = {
        id: Date.now().toString(),
        text: memoryText.trim(),
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        date: new Date().toLocaleString('ko-KR'),
      };

      // 3. 기존 목록에 추가하여 저장
      const updatedMemories = [...memories, newMemory];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      
      // 상태 업데이트
      setMemories(updatedMemories);
      
      // 4. 입력 필드 초기화
      setMemoryText('');
      
      // 5. 성공 메시지 표시
      showMessage('✨ Memory Saved!');

      // #region agent log
      debugLog('MapScreen.web.tsx:saveMemory', 'Memory saved successfully', { memory: newMemory }, 'A');
      // #endregion
    } catch (error) {
      console.error('메모리 저장 실패:', error);
      showMessage('❌ 저장에 실패했습니다.');
    }
  };

  // 메시지 표시 함수 (웹에서는 Alert 대신 텍스트로 표시)
  const showMessage = (message: string) => {
    setSaveMessage(message);
    setTimeout(() => setSaveMessage(''), 3000);
  };

  // #region agent log
  debugLog('MapScreen.web.tsx:render', 'MapScreen (web) rendering', { platform: 'web' }, 'B');
  // #endregion

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
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
      </View>

      {/* Memory Input Section */}
      <View style={styles.inputSection}>
        <TextInput
          style={styles.stickyNoteInput}
          placeholder="Leave a memory here..."
          placeholderTextColor="#a89f6a"
          value={memoryText}
          onChangeText={setMemoryText}
          multiline
          numberOfLines={3}
        />
        
        {/* Save Button */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSaveMemory}>
          <Text style={styles.saveButtonIcon}>📌</Text>
          <Text style={styles.saveButtonText}>Stick Memory</Text>
        </TouchableOpacity>

        {/* Save Message */}
        {saveMessage ? (
          <Text style={styles.saveMessage}>{saveMessage}</Text>
        ) : null}
      </View>

      {/* Debug View: Saved Memories List */}
      <View style={styles.debugSection}>
        <Text style={styles.debugTitle}>📋 저장된 메모리 ({memories.length}개)</Text>
        {memories.length === 0 ? (
          <Text style={styles.emptyText}>아직 저장된 메모리가 없습니다.</Text>
        ) : (
          memories.map((memory) => (
            <View key={memory.id} style={styles.memoryCard}>
              <Text style={styles.memoryText}>📝 {memory.text}</Text>
              <Text style={styles.memoryDate}>🕐 {memory.date}</Text>
              <Text style={styles.memoryLocation}>
                📍 {memory.latitude.toFixed(4)}, {memory.longitude.toFixed(4)}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  webMapPlaceholder: {
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  webMapIcon: {
    fontSize: 60,
    marginBottom: 16,
  },
  webMapTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 20,
    letterSpacing: 1,
  },
  webMapText: {
    fontSize: 16,
    color: '#a0a0a0',
    marginBottom: 8,
  },
  webMapCoords: {
    fontSize: 14,
    color: '#6366f1',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  // Memory Input Section
  inputSection: {
    padding: 20,
    alignItems: 'center',
  },
  stickyNoteInput: {
    width: '100%',
    maxWidth: 400,
    minHeight: 100,
    backgroundColor: '#FFF7D6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#5a5230',
    textAlignVertical: 'top',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#e8dfa3',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  saveButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  saveMessage: {
    marginTop: 12,
    fontSize: 16,
    color: '#10b981',
    fontWeight: '600',
  },
  // Debug Section
  debugSection: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#333355',
    marginTop: 10,
  },
  debugTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 16,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  memoryCard: {
    backgroundColor: '#2a2a4e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#6366f1',
  },
  memoryText: {
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 8,
    lineHeight: 22,
  },
  memoryDate: {
    fontSize: 12,
    color: '#a0a0a0',
    marginBottom: 4,
  },
  memoryLocation: {
    fontSize: 11,
    color: '#6366f1',
    fontFamily: 'monospace',
  },
});

