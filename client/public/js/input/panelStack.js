/**
 * The open panels, newest last. Esc closes the top one; a panel registers
 * when it opens and removes itself when it closes, however that happens.
 */
export function createPanelStack() {
  const panels = [];
  return {
    /** Registers an open panel; returns the function that removes it again. */
    push(panel) {
      panels.push(panel);
      return () => {
        const index = panels.indexOf(panel);
        if (index >= 0) panels.splice(index, 1);
      };
    },
    /** Closes the most recently opened panel; false when none is open. */
    closeTop() {
      const panel = panels.pop();
      if (!panel) return false;
      panel.close();
      return true;
    },
    get isOpen() {
      return panels.length > 0;
    },
  };
}
