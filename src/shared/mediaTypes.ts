/** File types the app offers in its pickers. FFmpeg can read far more; the picker also has an "All files" choice. */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mpg', 'mpeg', 'mts', 'm2ts', 'ts', 'wmv', 'flv', 'f4v', '3gp', 'ogv', 'vob', 'mxf', 'asf', 'divx']
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'amr']
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']

/** Filters for the Import dialog: one for everything the app knows, one for any file. */
export const IMPORT_FILTERS = [
  { name: 'Videos, audio and images', extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS] },
  { name: 'Videos', extensions: VIDEO_EXTENSIONS },
  { name: 'Audio', extensions: AUDIO_EXTENSIONS },
  { name: 'Images', extensions: IMAGE_EXTENSIONS },
  { name: 'All files', extensions: ['*'] }
]
