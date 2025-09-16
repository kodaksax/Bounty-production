// Declarations for web-only modules referenced in the codebase
// Broad fallbacks
declare module '@radix-ui/*';
declare module '@radix-ui/react-*';
declare module 'next/*';

// Specific Radix packages used in components
declare module '@radix-ui/react-popover';
declare module '@radix-ui/react-progress';
declare module '@radix-ui/react-radio-group';
declare module '@radix-ui/react-scroll-area';
declare module '@radix-ui/react-select';
declare module '@radix-ui/react-separator';
declare module '@radix-ui/react-slider';
declare module '@radix-ui/react-toast';
declare module '@radix-ui/react-toggle-group';
declare module '@radix-ui/react-toggle';
declare module '@radix-ui/react-tooltip';

// Other web-only modules
declare module 'react-resizable-panels';
declare module 'recharts';
declare module 'sonner';
declare module 'next-themes';

// Fallback for any other web-only modules used during web builds
declare module '*';

export { };

