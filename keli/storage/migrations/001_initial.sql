-- Keli Live initial schema (LLD section 3). Applied once by keli.storage.migrate.
-- Times are timestamptz (UTC); geometries are geography(Point, 4326) from GeoJSON [lon, lat].

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE weather_station (
  id                int PRIMARY KEY,
  name              text NOT NULL,
  geom              geography(Point, 4326) NOT NULL,
  collection_status text,                          -- GATHERING, REMOVED_TEMPORARILY...
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE camera (
  id                text PRIMARY KEY,              -- e.g. C0167400
  name              text NOT NULL,
  geom              geography(Point, 4326) NOT NULL,
  collection_status text,
  weather_station   int REFERENCES weather_station(id),  -- nearest station (PostGIS KNN)
  station_dist_m    int,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preset (
  id                text PRIMARY KEY,              -- e.g. C0167401
  camera_id         text NOT NULL REFERENCES camera(id),
  in_collection     boolean NOT NULL,
  lane_polygon      jsonb,                         -- normalised [x, y] points for the crop
  is_training       boolean NOT NULL DEFAULT false -- station within training radius
);

CREATE TABLE sensor_reading (
  station_id        int NOT NULL REFERENCES weather_station(id),
  sensor            text NOT NULL,                 -- KELI_1, TIE_1, VAROITUS_1...
  value             real NOT NULL,
  measured_at       timestamptz NOT NULL,
  PRIMARY KEY (station_id, sensor, measured_at)
);

CREATE TABLE image (
  id                bigserial PRIMARY KEY,
  preset_id         text NOT NULL REFERENCES preset(id),
  captured_at       timestamptz NOT NULL,
  thumb_key         text NOT NULL,
  full_key          text,                          -- only for training presets
  quality           jsonb,                         -- brightness, blur, night flag
  UNIQUE (preset_id, captured_at)
);

CREATE TABLE label (
  image_id          bigint NOT NULL REFERENCES image(id),
  source            text NOT NULL,                 -- sensor, zeroshot, rules, vlm, human, aggregate
  class             smallint NOT NULL,
  confidence        real,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (image_id, source)
);

CREATE TABLE model_version (
  id                text PRIMARY KEY,              -- e.g. convnext-t-2026-12-20
  metrics           jsonb NOT NULL,
  artifact_key      text NOT NULL,
  promoted_at       timestamptz
);

CREATE TABLE prediction (
  image_id          bigint NOT NULL REFERENCES image(id),
  model_id          text NOT NULL REFERENCES model_version(id),
  class             smallint NOT NULL,
  probs             real[] NOT NULL,
  confidence        real NOT NULL,
  PRIMARY KEY (image_id, model_id)
);

-- Which raw files from the ImageStore have been loaded, so imports are idempotent.
CREATE TABLE import_log (
  key               text PRIMARY KEY,              -- e.g. sensors/2026/11/24/0557.json.gz
  rows              int NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sensor_reading_measured_at ON sensor_reading (measured_at);
CREATE INDEX image_captured_at ON image (captured_at);
CREATE INDEX camera_geom ON camera USING gist (geom);
CREATE INDEX weather_station_geom ON weather_station USING gist (geom);
CREATE INDEX preset_camera ON preset (camera_id);
