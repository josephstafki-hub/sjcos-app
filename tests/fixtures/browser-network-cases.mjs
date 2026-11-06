// Expectations committed to the worktree before implementation. All addresses synthetic;
// no resolver, sockets, browser, or network calls are made by these fixtures.
export const adversarialUrls = [
  ['bare scheme', 'https:permit.example/a'],
  ['userinfo empty password', 'https://joe@permit.example/'],
  ['empty userinfo', 'https://@permit.example/'],
  ['encoded authority', 'https://%70ermit.example/'],
  ['backslash authority', 'https://permit.example\\@evil.example/'],
  ['tab in authority', 'https://per\tmit.example/'],
  ['newline suffix', 'https://permit.example/\n'],
  ['fragment', 'https://permit.example/#secret'],
  ['empty fragment', 'https://permit.example/#'],
  ['encoded slash', 'https://permit.example/a%2fb'],
  ['encoded backslash', 'https://permit.example/a%5cb'],
  ['encoded dot traversal', 'https://permit.example/%2e%2e/admin'],
  ['literal dot traversal', 'https://permit.example/a/../admin'],
  ['double encoded slash', 'https://permit.example/%252fadmin'],
  ['encoded control', 'https://permit.example/?x=%00'],
  ['invalid UTF8', 'https://permit.example/?x=%ff'],
  ['duplicate query', 'https://permit.example/?x=1&x=2'],
  ['encoded duplicate query', 'https://permit.example/?x=1&%78=2'],
  ['trailing dot', 'https://permit.example./'],
  ['unicode trailing dot', 'https://permit.example。/'],
  ['hex IP', 'https://0x7f000001/'],
  ['octal IP', 'https://0177.0.0.1/'],
  ['short IP', 'https://127.1/'],
  ['decimal IP', 'https://2130706433/'],
  ['IPv6 literal', 'https://[2606:4700:4700::1111]/'],
  ['nonstandard port', 'https://permit.example:8443/'],
  ['zero padded port', 'https://permit.example:0443/'],
  ['local suffix', 'https://printer.local/'],
  ['single label', 'https://metadata/'],
  ['websocket', 'wss://permit.example/'],
];
export const nonglobalAddresses = [
  '0.0.0.0', '0.1.2.3', '10.2.3.4', '100.64.0.1', '100.100.100.200',
  '100.127.255.254', '127.0.0.1', '169.254.169.254', '168.63.129.16', '172.16.0.1', '172.31.255.255',
  '192.168.1.1', '192.0.0.9', '192.0.2.1', '192.88.99.1', '198.18.0.1',
  '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
  '::', '::1', '::ffff:8.8.8.8', '::8.8.8.8', '64:ff9b::808:808',
  '64:ff9b:1::a00:1', '100::1', '2001::1', '2001:2::1', '2001:10::1',
  '2001:20::1', '2001:db8::1', '2002:808:808::1', '3fff::1',
  '2001:4860::5efe:a00:1', '2001:4860::200:5efe:a00:1',
  'fc00::1', 'fd00:ec2::254', 'fe80::1', 'ff02::1', 'fe80::1%eth0', 'garbage',
];
export const appConfig = {
  appHosts: ['sjcos.example', 'tunnel.example'], serviceHosts: ['db.internal', 'mcp.internal'],
  hostPublicAddresses: ['8.8.4.4', '2606:4700:4700::1001'],
};
export const manifest = {revision: 1, origins: [
  {origin:'https://permit.example',role:'document'},
  {origin:'https://login.example',role:'identity'},
  {origin:'https://assets.example',role:'resource'},
]};
export const dns = (hostname='permit.example', addresses=['8.8.8.8']) => ({
  hostname, complete:true, expiresAt:2000,
  chain:[{name:hostname,cname:null,addresses}],
});
