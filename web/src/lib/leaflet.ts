// Leaflet.draw is a classic plugin that extends the global `L`, so expose Leaflet globally
// before it loads. Import this module (not 'leaflet-draw' directly) wherever drawing is used.
import L from 'leaflet';

(window as unknown as { L: typeof L }).L = L;

export default L;
