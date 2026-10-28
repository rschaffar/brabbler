// Approved Brabbler artwork. Keep the head-only shape and crooked, round-tipped antenna.
const ink = '#19272F', coral = '#EE7C60', face = '#FFF9ED';

function mouth(pose = 0) {
  if (pose === 1) return `<path d="M119 181Q172 167 225 181V197Q225 222 172 222Q119 222 119 197Z" fill="${ink}"/><path d="M145 216Q172 199 199 216" fill="${coral}"/><path d="M136 180V190H155V178M171 177V190H190V178M206 180V190H217V182" fill="${face}"/>`;
  if (pose === 2) return `<rect x="151" y="173" width="46" height="62" rx="23" fill="${ink}"/><ellipse cx="174" cy="225" rx="14" ry="7" fill="${coral}"/>`;
  return `<path d="M117 179Q171 173 228 179Q228 232 174 232Q120 232 117 179Z" fill="${ink}"/><path d="M149 225Q174 207 200 225Q176 237 149 225Z" fill="${coral}"/><path d="M136 178V193H156V177M174 177V193H194V177M211 178V191H223V179" fill="${face}"/>`;
}

function robot(pose = 0, blink = false) {
  const eyes = blink
    ? `<path d="M112 139Q123 129 136 139M184 128Q196 116 208 128" fill="none" stroke="${ink}" stroke-width="9" stroke-linecap="round"/>`
    : `<rect x="112" y="118" width="24" height="29" rx="10" fill="${ink}"/><rect x="184" y="105" width="26" height="34" rx="11" fill="${ink}"/><rect x="126" y="123" width="5" height="7" rx="2.5" fill="${face}"/><rect x="199" y="111" width="5" height="7" rx="2.5" fill="${face}"/>`;
  return `<g transform="rotate(-6 180 160)">
    <path d="M166 67V49L185 35L173 17" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="173" cy="17" r="8" fill="${coral}" stroke="${ink}" stroke-width="5"/>
    <rect x="46" y="128" width="33" height="67" rx="13" fill="${coral}" stroke="${ink}" stroke-width="8"/>
    <rect x="281" y="117" width="33" height="67" rx="13" fill="${coral}" stroke="${ink}" stroke-width="8"/>
    <path d="M99 65H242Q282 65 282 105V213Q282 253 242 253H136L96 281V253Q72 250 72 213V105Q72 65 99 65Z" fill="${face}" stroke="${ink}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M98 100L123 93M180 88Q198 80 216 91" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
    ${eyes}
    <path d="M94 162H104M226 154H236" stroke="${coral}" stroke-width="7" stroke-linecap="round"/>
    ${mouth(pose)}
    <path d="M252 108V127" stroke="${coral}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="252" cy="139" r="3" fill="${coral}"/>
  </g>`;
}

export function robotSvg(pose = 0, blink = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="640" viewBox="0 0 360 320" role="img" aria-label="Brabbler robot face with a crooked antenna"><title>Brabbler robot face with a crooked antenna</title>${robot(pose, blink)}</svg>\n`;
}
