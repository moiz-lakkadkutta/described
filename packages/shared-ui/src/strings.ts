/** All user-facing copy. Plain, short, present tense. Says "described" and "on/off" — never the blocklisted words (see docs/decisions/0002-wording.md). */
export const strings = {
  firstRun: [
    { title: 'Described plays every film with audio description.', body: "It's on now.", cta: 'Next' },
    { title: 'Press Menu while watching.', body: 'Change the voice, captions, or turn description off.', cta: 'Next' },
    { title: 'Extended mode pauses the film when there is a lot to describe.', body: 'Keep it on?', cta: 'Keep on', alt: 'Turn off' },
  ],
  home: { continue: 'Continue watching', newly: 'Newly described', all: 'All titles', playWithAd: 'Play with description', play: 'Play', myList: 'My list' },
  title: { hearSample: 'Hear a sample', processing: (min: number) => `We're still describing this film — about ${min} minutes left.`, more: 'More' },
  player: { statusOn: (voice: string, cap: string) => `Description on · ${voice} · ${cap}`, statusOff: 'Description off', loading: 'Loading…', error: 'Playback stopped. Press Select to try again, Back for the title.', extendedBar: 'Describing…' },
  tracks: { heading: 'Audio & captions', audio: 'Audio', original: 'Original', ad: (voice: string) => `Audio description (${voice})`, captions: 'Captions', off: 'Off', plain: 'Captions', rich: 'Rich captions', descText: 'Description text', extended: 'Extended mode', announceOn: 'Description on', announceOff: 'Description off' },
  settings: { adDefault: 'Description on by default', voice: 'Voice', hearIt: 'Hear it', extended: 'Extended mode', capSize: 'Caption size', capStyle: 'Caption style', reset: 'Show first-run again', about: 'About & licenses' },
  offline: 'Can\u2019t reach the library. Check the network and press Select to retry.',
  rail: { home: 'Home', described: 'Described', list: 'My list', settings: 'Settings' },
}
