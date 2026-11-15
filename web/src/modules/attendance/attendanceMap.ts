export interface MapPoint { latitude?: number; longitude?: number; radius?: number }

export type MapSdk = {
  LatLng: new (lat: number, lng: number) => { getLat(): number; getLng(): number };
  Map: new (element: HTMLElement, options: object) => {
    on: (event: string, fn: (event: { latLng: { getLat(): number; getLng(): number } }) => void) => void;
    setCenter: (center: unknown) => void;
    destroy: () => void;
  };
  MultiMarker: new (options: object) => { setGeometries: (items: object[]) => void; setMap: (map: null) => void };
  MultiCircle: new (options: object) => { setGeometries: (items: object[]) => void; setMap: (map: null) => void };
  CircleStyle: new (options: object) => unknown;
};

export function createAttendanceMap(sdk: MapSdk, element: HTMLElement, initial: MapPoint, onSelect: (lat: number, lng: number) => void, onReady: () => void) {
  const map = new sdk.Map(element, { center: new sdk.LatLng(initial.latitude ?? 23.1291, initial.longitude ?? 113.2644), zoom: 16 });
  const marker = new sdk.MultiMarker({ map, geometries: [] });
  const circle = new sdk.MultiCircle({ map, styles: { range: new sdk.CircleStyle({ color: 'rgba(0,0,0,0.12)', borderColor: '#1A1A1A', borderWidth: 2 }) }, geometries: [] });
  let previous: MapPoint = {};
  const update = ({ latitude, longitude, radius }: MapPoint) => {
    if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      marker.setGeometries([]);
      circle.setGeometries([]);
      previous = {};
      return;
    }
    const center = new sdk.LatLng(latitude, longitude);
    marker.setGeometries([{ id: 'site', position: center }]);
    circle.setGeometries([{ id: 'range', styleId: 'range', center, radius: radius || 100 }]);
    if (previous.latitude !== latitude || previous.longitude !== longitude) map.setCenter(center);
    previous = { latitude, longitude, radius };
  };
  map.on('click', event => onSelect(Number(event.latLng.getLat().toFixed(7)), Number(event.latLng.getLng().toFixed(7))));
  map.on('tilesloaded', onReady);
  update(initial);
  return { update, destroy: () => { marker.setMap(null); circle.setMap(null); map.destroy(); } };
}
