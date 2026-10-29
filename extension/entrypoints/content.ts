import { captureSelection } from '@/lib/capture-selection';

// Injected on demand by the background (activeTab), so no broad host permissions.
export default defineContentScript({
  registration: 'runtime',
  main() {
    return captureSelection();
  },
});
