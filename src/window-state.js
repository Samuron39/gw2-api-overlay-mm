'use strict';
// Rene vindusregler, slik at alt-tab/spillstart kan testes uten Electron.
function visibility({ wheelWanted, panelWanted, gameRunning, followGame, autoHidden, manuallyHidden, wheelForced }) {
  const gameHidden = !!followGame && gameRunning === false;
  return {
    wheel: !!wheelWanted && (!gameHidden || !!wheelForced) && !autoHidden,
    // Panelet åpnes eksplisitt av brukeren også når spillet ikke kjører.
    panel: !!panelWanted && !autoHidden,
    overlays: !gameHidden && !autoHidden && !manuallyHidden,
  };
}
function clamp(x, y, width, height, area) {
  return {
    x: Math.round(Math.max(area.x, Math.min(Number(x) || 0, area.x + Math.max(0, area.width - width)))),
    y: Math.round(Math.max(area.y, Math.min(Number(y) || 0, area.y + Math.max(0, area.height - height)))),
  };
}
module.exports = { visibility, clamp };
