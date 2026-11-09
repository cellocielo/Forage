/** The Forage acorn. Matches public/icon/*.png. */
export function Acorn({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M32 13 C32 9 34 5 38 4" fill="none" stroke="#4a3220" strokeWidth="4" strokeLinecap="round" />
      <path d="M15 33 H49 C49 47 42 56 32 60 C22 56 15 47 15 33 Z" fill="#d49a4e" />
      <path d="M21 37 C21 45 24 50 28 54" fill="none" stroke="#ecc283" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M8 30 C8 18 19 11 32 11 C45 11 56 18 56 30 C56 33 54 35 51 35 H13 C10 35 8 33 8 30 Z" fill="#6e4a2c" />
      <path
        d="M15 23 L21 29 M23 16 L32 26 M34 14 L43 24 M45 17 L51 24"
        fill="none"
        stroke="#8a6140"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
