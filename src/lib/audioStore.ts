const DB_NAME = 'ChordMemoAudioDB';
const DB_VERSION = 1;
const STORE = 'audio_files';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
  });
}

/** オーディオ本体は localStorage に載らないので projectId 紐付けで IndexedDB に置く */
export async function saveAudio(projectId: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction([STORE], 'readwrite').objectStore(STORE).put(blob, projectId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getAudio(projectId: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction([STORE], 'readonly').objectStore(STORE).get(projectId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

export async function deleteAudio(projectId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction([STORE], 'readwrite').objectStore(STORE).delete(projectId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
