#!/usr/bin/env python3
"""Build a small SVG path/centroid asset from Natural Earth 1:110m GeoJSON.

Source: https://github.com/datasets/geo-boundaries-world-110m
Natural Earth boundaries are public domain; the packaged GeoJSON is ODC-PDDL.
"""
import json
import urllib.request
from pathlib import Path

SOURCE = 'https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/main/countries.geojson'
TARGET = Path(__file__).resolve().parents[1] / 'public' / 'data' / 'world-map.json'


def project(point):
    longitude, latitude = point[:2]
    return (round((longitude + 180) * 2.5, 1), round((90 - latitude) * 2.3, 1))


def polygon_path(rings):
    parts = []
    for ring in rings:
        points = [project(point) for point in ring]
        if not points:
            continue
        parts.append('M' + 'L'.join(f'{x:g},{y:g}' for x, y in points) + 'Z')
    return ''.join(parts)


def centroid(polygons):
    ring = max((polygon[0] for polygon in polygons if polygon), key=lambda points: len(points))
    xs, ys = zip(*(project(point) for point in ring))
    return [round(sum(xs) / len(xs), 1), round(sum(ys) / len(ys), 1)]


def main():
    with urllib.request.urlopen(SOURCE, timeout=30) as response:
        features = json.load(response)['features']
    countries = []
    for feature in features:
        geometry = feature['geometry']
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        code = feature['properties'].get('iso_a2')
        countries.append({'code': code if code and len(code) == 2 else '',
                          'path': ''.join(polygon_path(polygon) for polygon in polygons),
                          'center': centroid(polygons)})
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps({'width': 900, 'height': 414, 'countries': countries}, separators=(',', ':')) + '\n')
    print(f'Wrote {TARGET} ({len(countries)} countries)')


if __name__ == '__main__':
    main()
