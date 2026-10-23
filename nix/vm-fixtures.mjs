// Synthetic contract fixtures, never executable service bindings.
export function registryFixture(workers = 2) {
  return { version: 1, package: `/nix/store/${'a'.repeat(32)}-package/lib/node_modules/@agegr/pi-web`,
    resources: { workers, cpus: workers * 2, memoryMiB: workers * 4096 },
    lanes: Array.from({ length: workers }, (_, i) => ({ id: `l${i}`, user: `t${i}`, uid: 1000 + i,
      home: `/home/t${i}`, port: 30141 + i, envFile: `/home/t${i}/service.env`, unit: 'pi-web.service',
      controller: `/nix/store/${'b'.repeat(32)}-controller/bin/pi-web-test-service-l${i}` })) };
}
