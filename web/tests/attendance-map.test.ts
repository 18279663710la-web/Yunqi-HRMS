import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createAttendanceMap, type MapSdk } from '../src/modules/attendance/attendanceMap';

function fakeSdk() {
  const instances: { map?: FakeMap; markers: FakeLayer[]; circles: FakeLayer[] } = { markers: [], circles: [] };
  class LatLng { constructor(public lat: number, public lng: number) {} getLat() { return this.lat; } getLng() { return this.lng; } }
  class FakeMap {
    center: LatLng;
    events: Record<string, (...args: any[]) => void> = {};
    destroyed = false;
    constructor(_element: HTMLElement, options: { center: LatLng }) { this.center = options.center; instances.map = this; }
    on(event: string, callback: (...args: any[]) => void) { this.events[event] = callback; }
    setCenter(center: LatLng) { this.center = center; }
    destroy() { this.destroyed = true; }
  }
  class FakeLayer {
    geometries: any[] = [];
    detached = false;
    setGeometries(items: any[]) { this.geometries = items; }
    setMap(map: null) { this.detached = map === null; }
  }
  class MultiMarker extends FakeLayer { constructor(_options: object) { super(); instances.markers.push(this); } }
  class MultiCircle extends FakeLayer { constructor(_options: object) { super(); instances.circles.push(this); } }
  class CircleStyle { constructor(_options: object) {} }
  return { sdk: { LatLng, Map: FakeMap, MultiMarker, MultiCircle, CircleStyle } as unknown as MapSdk, instances };
}

test('地图初始化和后续坐标更新始终定位到当前打卡中心', () => {
  const { sdk, instances } = fakeSdk();
  const selections: number[][] = [];
  let ready = false;
  const controller = createAttendanceMap(sdk, {} as HTMLElement, { latitude: 22.9, longitude: 113.8, radius: 77 }, (lat, lng) => selections.push([lat, lng]), () => { ready = true; });
  assert.deepEqual([instances.map!.center.lat, instances.map!.center.lng], [22.9, 113.8]);
  assert.equal(instances.circles[0].geometries[0].radius, 77);
  instances.map!.events.tilesloaded();
  assert.equal(ready, true);
  instances.map!.events.click({ latLng: new sdk.LatLng(23.123456789, 114.123456789) });
  assert.deepEqual(selections, [[23.1234568, 114.1234568]]);
  controller.update({ latitude: 23.1, longitude: 114.1, radius: 100 });
  assert.deepEqual([instances.map!.center.lat, instances.map!.center.lng], [23.1, 114.1]);
  assert.equal(instances.circles[0].geometries[0].radius, 100);
  controller.update({ latitude: undefined, longitude: 114.1, radius: 100 });
  assert.deepEqual(instances.markers[0].geometries, []);
  assert.deepEqual(instances.circles[0].geometries, []);
  controller.destroy();
  assert.equal(instances.map!.destroyed, true);
  assert.equal(instances.markers[0].detached, true);
  assert.equal(instances.circles[0].detached, true);
});
