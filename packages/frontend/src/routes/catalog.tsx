import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { TracksPage } from '../pages/catalog/TracksPage';
import { TrackPage } from '../pages/catalog/track/TrackPage';
import { ReleasesPage } from '../pages/catalog/ReleasesPage';
import { ReleasePage } from '../pages/catalog/ReleasePage';
import { ArtistsPage } from '../pages/reference/artists/ArtistsPage';
import { DuplicatesPage } from '../pages/reference/artists/DuplicatesPage';
import { ArtistPage } from '../pages/reference/artists/ArtistPage';

/** Каталог: tracks and releases, pseudonyms; owners live in routes/owners.tsx. */
export const catalogRoutes = [
  <Route key="tracks" path={ROUTE_PATHS.tracks} element={<TracksPage />} />,
  <Route key="track" path={ROUTE_PATHS.track} element={<TrackPage />} />,
  <Route key="releases" path={ROUTE_PATHS.releases} element={<ReleasesPage />} />,
  <Route key="release" path={ROUTE_PATHS.release} element={<ReleasePage />} />,
  <Route key="artists" path={ROUTE_PATHS.artists} element={<ArtistsPage />} />,
  <Route key="artist-duplicates" path={ROUTE_PATHS.artistDuplicates} element={<DuplicatesPage />} />,
  <Route key="artist" path={ROUTE_PATHS.artist} element={<ArtistPage />} />,
];
