/** Fonts bundled with the app, by category. Every one is open-licence (SIL OFL / Apache) and works offline. */
export interface FontEntry { family: string }
export const FONT_CATEGORIES: { name: string; fonts: string[] }[] = [
  { name: 'Sans', fonts: ['Inter', 'DM Sans', 'Space Grotesk', 'Montserrat', 'Poppins', 'Roboto', 'Open Sans', 'Lato', 'Raleway', 'Nunito', 'Work Sans', 'Manrope', 'Outfit', 'Sora', 'Plus Jakarta Sans', 'Rubik', 'Barlow', 'Urbanist', 'Lexend', 'Figtree'] },
  { name: 'Serif', fonts: ['Instrument Serif', 'Playfair Display', 'Cormorant Garamond', 'DM Serif Display', 'Lora', 'Merriweather', 'Libre Baskerville', 'Cinzel', 'Bodoni Moda', 'Abril Fatface', 'EB Garamond', 'Fraunces'] },
  { name: 'Display', fonts: ['Monocraft', 'Archivo Black', 'Anton', 'Bebas Neue', 'Oswald', 'Bangers', 'Righteous', 'Lilita One', 'Staatliches', 'Black Ops One', 'Monoton', 'Orbitron', 'Audiowide', 'Press Start 2P', 'Bungee', 'Fredoka', 'Creepster', 'Russo One', 'Teko', 'Chakra Petch', 'Rajdhani', 'Syncopate', 'Bowlby One', 'Sigmar One', 'Passion One', 'Fugaz One'] },
  { name: 'Handwriting', fonts: ['Permanent Marker', 'Pacifico', 'Lobster', 'Caveat', 'Shadows Into Light', 'Special Elite', 'Dancing Script', 'Great Vibes', 'Sacramento', 'Satisfy', 'Rock Salt'] },
  { name: 'Mono', fonts: ['Monocraft', 'JetBrains Mono', 'VT323', 'Space Mono', 'Fira Code', 'IBM Plex Mono'] },
]
export const ALL_FONTS: string[] = [...new Set(FONT_CATEGORIES.flatMap((c) => c.fonts))]
