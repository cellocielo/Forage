import { requestSaveWord } from './messaging';
import { getSelectionContext } from './selection';
import { showToast } from './toast';

/** Runs in the page: reads the selection, saves it, and confirms with a toast. */
export async function captureSelection(win: Window = window): Promise<void> {
  const context = getSelectionContext(win);
  if (!context) {
    showToast('Select a word to save it to Forage.', { variant: 'error', doc: win.document });
    return;
  }

  const result = await requestSaveWord(context);
  if (result.ok && result.queued) {
    showToast(`Saved "${result.word}". It'll sync when you're back online.`, { doc: win.document });
  } else if (result.ok) {
    showToast(`Saved "${result.word}" to Forage`, { doc: win.document });
  } else {
    showToast(result.message, { variant: 'error', doc: win.document });
  }
}
