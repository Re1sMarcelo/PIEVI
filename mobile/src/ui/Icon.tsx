import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

export type IconName = 'temperature' | 'drop' | 'reservoir' | 'settings' | 'plant' | 'sprinkler'
  | 'home' | 'controls' | 'history' | 'bell' | 'mail' | 'lock' | 'eye' | 'eyeOff'
  | 'chevron' | 'chart' | 'check' | 'warning' | 'logout' | 'info';

export function Icon({ name, size = 24, color = colors.greenDark }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {name === 'temperature' && <><Path d="M9 14.6V5a3 3 0 0 1 6 0v9.6a5 5 0 1 1-6 0Z" /><Path d="M12 6v11" /><Circle cx="12" cy="18" r="1.8" fill={color} strokeWidth={0} /></>}
      {name === 'drop' && <Path d="M12 2S4.5 11 4.5 15.5a7.5 7.5 0 0 0 15 0C19.5 11 12 2 12 2Z" />}
      {name === 'reservoir' && <><Rect x="3.5" y="3" width="17" height="18" rx="2.5" /><Path d="M4 14c3-4 5 4 8 0s5 4 8 0" /></>}
      {name === 'settings' && <><Path d="m9 2-.7 3-2 .9-2.7-.8-2 3.5 2.2 2.1v2.5l-2.2 2.1 2 3.5 2.8-.8 2 1 .6 3h4l.7-3 2-.9 2.7.8 2-3.5-2.2-2.1v-2.5l2.2-2.1-2-3.5-2.8.8-2-1-.6-3Z" /><Circle cx="11" cy="12" r="3.5" /></>}
      {name === 'plant' && <><Path d="M10 22V11M10 16C3 16 2 11 2 6c6 .5 9 3 8 10Zm0 4c0-5 3-8 8-8 0 5-3 8-8 8ZM5 10l5 6m5 0-5 4" /><Path d="M18 1s-3.5 4.5-3.5 6.4a3.5 3.5 0 0 0 7 0C21.5 5.5 18 1 18 1Z" /></>}
      {name === 'sprinkler' && <><Path d="M5 22h14M9 22v-6a3 3 0 0 1 6 0v6M12 2v2m0 3v1M5 5l1.5 1.5m11-1.5L16 6.5M2 11h2m16 0h2M7.5 10l1 1m7-1-1 1" /></>}
      {name === 'home' && <><Path d="m2 11 10-9 10 9M5 9v12h5v-7h4v7h5V9" /></>}
      {name === 'controls' && <><Path d="M3 5h7m4 0h7M3 12h12m4 0h2M3 19h3m4 0h11" /><Circle cx="12" cy="5" r="2" /><Circle cx="17" cy="12" r="2" /><Circle cx="8" cy="19" r="2" /></>}
      {name === 'history' && <><Path d="M5 2h10l4 4v16H5ZM14 2v5h5M8 11h8M8 15h8M8 19h5" /></>}
      {name === 'bell' && <><Path d="M4 18c2-2 2-3 2-8a6 6 0 0 1 12 0c0 5 0 6 2 8ZM10 21a2 2 0 0 0 4 0M12 2V1" /></>}
      {name === 'mail' && <><Rect x="2" y="4" width="20" height="16" rx="2" /><Path d="m3 6 9 7 9-7" /></>}
      {name === 'lock' && <><Rect x="5" y="10" width="14" height="12" rx="2" /><Path d="M8 10V6a4 4 0 0 1 8 0v4" /></>}
      {(name === 'eye' || name === 'eyeOff') && <><Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><Circle cx="12" cy="12" r="3" />{name === 'eyeOff' && <Path d="M3 3 21 21" />}</>}
      {name === 'chevron' && <Path d="m9 5 7 7-7 7" />}
      {name === 'chart' && <Path d="M5 20v-9m7 9V4m7 16v-13" strokeWidth={3} />}
      {name === 'check' && <Path d="m5 12 4.5 4.5L19 7" strokeWidth={2.4} />}
      {name === 'warning' && <><Path d="m10.3 3.8-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z" /><Path d="M12 9v5m0 3h.01" strokeWidth={2.2} /></>}
      {name === 'logout' && <><Path d="M9 3H4v18h5M9 12h12m-4-4 4 4-4 4" /></>}
      {name === 'info' && <><Circle cx="12" cy="12" r="9" /><Path d="M12 11v6m0-10h.01" strokeWidth={2} /></>}
    </Svg>
  );
}
