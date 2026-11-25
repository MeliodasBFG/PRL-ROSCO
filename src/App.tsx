import React, { useEffect } from 'react';
import { useRoscoStore } from './store/useRoscoStore';
import { WelcomeAndLobbyScreen } from './components/screens/WelcomeAndLobbyScreen';
import { PresenterScreen } from './components/screens/PresenterScreen';
import { ContestantScreen } from './components/screens/ContestantScreen';

export const App: React.FC = () => {
  const { role, publicState, tickLocalTimerDisplay, restoreSessionFromStorage } = useRoscoStore();

  useEffect(() => {
    void restoreSessionFromStorage();
  }, [restoreSessionFromStorage]);

  // Interpolador visual suave (100ms) gobernado por el timestamp autoritativo del servidor
  useEffect(() => {
    const id = window.setInterval(() => {
      tickLocalTimerDisplay();
    }, 100);
    return () => window.clearInterval(id);
  }, [tickLocalTimerDisplay]);

  // Si todavía no ha entrado a una sala o la sala está en estado WAITING (Sala de Espera)
  if (role === 'NONE' || !publicState || publicState.status === 'WAITING') {
    return <WelcomeAndLobbyScreen />;
  }

  // Vista protegida exclusiva del Presentador
  if (role === 'HOST') {
    return <PresenterScreen />;
  }

  // Vista de los Concursantes (sin controles administrativos)
  return <ContestantScreen />;
};

export default App;
