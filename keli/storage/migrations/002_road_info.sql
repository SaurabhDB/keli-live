-- Winter maintenance tracks and road weather forecasts (Digitraffic), loaded by the importer.
-- Geometries arrive as GeoJSON with a zero third coordinate; stored 2-D.

CREATE TABLE maintenance_route (
  id                bigint PRIMARY KEY,            -- Digitraffic tracking id
  start_time        timestamptz NOT NULL,
  end_time          timestamptz NOT NULL,
  tasks             text[] NOT NULL,               -- SALTING, LINE_SANDING, ...
  geom              geography(Geometry, 4326) NOT NULL  -- LineString track or Point
);

CREATE TABLE forecast_section (
  id                text PRIMARY KEY,              -- e.g. 00001_001_000_0
  description       text NOT NULL,                 -- "Vt 1: Helsinki - Kehä III"
  road_number       int,
  geom              geography(Geometry, 4326) NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE road_forecast (
  section_id        text NOT NULL REFERENCES forecast_section(id),
  issued_at         timestamptz NOT NULL,          -- when this set of forecasts was published
  name              text NOT NULL,                 -- 0h (observation), 2h, 4h, 6h, 12h
  valid_at          timestamptz NOT NULL,
  kind              text NOT NULL,                 -- OBSERVATION or FORECAST
  road_temp_c       real,
  air_temp_c        real,
  road_condition    text,                          -- DRY, FROST, PARTLY_ICY, ICE, SNOW, ...
  overall_condition text,                          -- NORMAL_CONDITION, POOR_CONDITION, ...
  PRIMARY KEY (section_id, issued_at, name)
);

CREATE INDEX maintenance_route_geom ON maintenance_route USING gist (geom);
CREATE INDEX maintenance_route_end_time ON maintenance_route (end_time);
CREATE INDEX forecast_section_geom ON forecast_section USING gist (geom);
CREATE INDEX road_forecast_issued_at ON road_forecast (issued_at);
