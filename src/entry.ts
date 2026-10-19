import { cityLaunchRequested } from './session/city-launch.ts';

// The city does not need the original circuit, garages and replay UI in memory.
// Keep both entry points on the same production simulation/rendering modules.
if (cityLaunchRequested(location.search)) await import('./charlottetown-app.ts');
else await import('./main.ts');
