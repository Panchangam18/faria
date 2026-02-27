import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyA7222J2l9CiCMrX6xMUkIVkiTGC88pSas',
  authDomain: 'faria-6f4b8.firebaseapp.com',
  projectId: 'faria-6f4b8',
  storageBucket: 'faria-6f4b8.firebasestorage.app',
  messagingSenderId: '1002852709892',
  appId: '1:1002852709892:web:3c5fd2ebe290aa6e68e751',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
