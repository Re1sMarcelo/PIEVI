import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

export function StrawberryLogo({ size = 100 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 116 116">
      <Defs>
        <LinearGradient id="berry" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#e32d43" /><Stop offset="1" stopColor="#ba1533" /></LinearGradient>
        <LinearGradient id="water" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#57b1d8" /><Stop offset="1" stopColor="#218cbe" /></LinearGradient>
      </Defs>
      <Path d="M45 33C33 29 21 32 15 24c-5-7-6-16-5-19 16 0 27 10 35 28ZM45 31C31 17 34 8 43 0c10 12 13 20 2 31ZM48 34C52 16 64 6 78 6c1 15-10 25-30 28Z" fill="#087a40" />
      <Path d="M43 38C21 27 3 39 4 60c1 20 29 51 45 54 17 2 47-39 46-63-1-17-23-19-39-12-4 2-8 2-13-1Z" fill="url(#berry)" />
      {[ [18,52], [38,49], [62,49], [26,72], [48,72], [71,70], [40,92], [55,101] ].map(([x,y]) => <Path key={`${x}-${y}`} d={`M${x} ${y}c-3-5-5 3-3 6 2 4 6-1 3-6Z`} fill="#fff7e7" />)}
      <Path d="M91 32c-4 10-23 34-23 50a24 24 0 0 0 48 0c0-16-19-40-25-50Z" fill="url(#water)" stroke="#fffcfa" strokeWidth="5" />
      <Path d="M83 75c-4 10-1 18 7 21" stroke="white" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

// Decorative line art follows the strawberry and leaf motif in the supplied designs.
export function BotanicalArt({ width = 220, height = 200, opacity = 0.3 }: { width?: number; height?: number; opacity?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 240 220" fill="none">
      <G stroke="#fff1e9" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" opacity={opacity}>
        <Path d="M239 219C208 169 191 116 152 91S94 82 47 46M191 141c-17-28-30-29-56-30M157 93c24-26 35-43 42-73M185 130c32 6 37 21 48 43M143 88c-6-27-12-36-25-51" />
        <Path d="M90 70C62 66 41 42 32 12l11 4-1-8 11 7 1-7 9 9 3-7 8 13 4-6 5 15 7-4 1 15 7-1-3 12 7 2-12 14Z" />
        <Path d="M91 70 43 19m41 41-22-5m13-4-18-6m11-3-16-7m25 14 2-17m5 27 3-16M64 39V22" />
        <Path d="M89 75C59 60 28 65 6 87l10 2-7 8 13-1-5 8 13-3-2 8 12-5 2 7 12-7 3 6 9-8 5 4 7-10 6 2 5-13Z" />
        <Path d="M87 76 15 88m58-10-13-8m0 10-12-9m-2 11-12-9m35 7-10 14m-4-11-11 13m-3-11-11 12" />
        <Path d="M159 91c4-33 29-62 66-70l-4 10 8-1-5 11 8 1-9 9 6 4-12 7 3 6-14 3 1 7-14 1-1 7-15-1-3 6-15 0Z" />
        <Path d="m162 89 54-59m-43 48 21-1m-12-10 19-1m-9-9 19-3m-28 15 0-15m-10 25-2-16" />
        <Path d="M126 108c-15-8-30-1-28 14 2 17 12 36 21 37 10-2 26-26 25-40-1-13-10-18-18-11Z" />
        <Path d="m107 106 7-6 5 7 7-11 3 12 10-5-2 9-16-3-13 4Z" />
        <Path d="m109 122 1 3m12-6 1 3m10-1 1 3m-19 6 1 3m10-4 1 3m-7 7 1 3" />
        <Path d="M183 153c-17-8-35-1-32 18 2 19 15 42 26 43 13-2 31-33 30-49-2-15-14-19-24-12Z" />
        <Path d="m157 151 8-7 7 9 8-13 3 14 13-6-3 10-19-3-14 4Z" />
        <Path d="m164 168 1 4m14-7 1 4m13-1 1 4m-25 7 1 4m14-7 1 4m-11 10 1 4" />
        <Path d="M209 103c-9-6-19-3-19 8 0 12 9 27 15 28 9-2 19-17 20-28 0-9-10-13-16-8Zm-13-2 5-5 4 6 5-9 2 10 8-3-2 7-13-3-9 3" />
        <Path d="m200 113 1 2m10-3 1 2m-7 7 1 2" />
        <Path d="M130 49c-5-13-18-13-18-3-13-4-21 8-10 15-12 8-2 21 9 13 0 14 16 16 18 3 10 9 22-3 12-12 13-7 3-22-11-16Z" />
        <Path d="m121 59-4-10m2 13-13-6m13 10-9 8m14-6 3 10m0-14 13-1m-14-4 7-9" />
        <Path d="M121 60a6 6 0 1 0 1 0Z" />
      </G>
    </Svg>
  );
}

export function LoginWave() {
  return <Svg width="100%" height={48} viewBox="0 0 400 48" preserveAspectRatio="none"><Path d="M0 25C110-16 167 2 262 29S356 52 400 32V48H0Z" fill="#fffcfa" /></Svg>;
}
