import { createRequire } from 'node:module';

// Jiti must receive the actual public CJS default, including its forwardRef
// identity. No replacement component, copied rendering or alternate image API.
const actual = createRequire(import.meta.url)('next/image');
export default actual.default;
export const getImageProps = actual.getImageProps;
