import { Route } from 'react-router-dom';
import { TracksPage } from '../pages/catalog/TracksPage';
import { TrackPage } from '../pages/catalog/track/TrackPage';
import { ReleasesPage } from '../pages/catalog/ReleasesPage';
import { ReleasePage } from '../pages/catalog/ReleasePage';
import { ArtistsPage } from '../pages/reference/artists/ArtistsPage';
import { DuplicatesPage } from '../pages/reference/artists/DuplicatesPage';
import { ArtistPage } from '../pages/reference/artists/ArtistPage';

/** Каталог: tracks and releases (step 3.6), pseudonyms (step 3.8); owners live in routes/owners.tsx. */
export const catalogRoutes = [
  <Route key="tracks" path="tracks" element={<TracksPage />} />,
  <Route key="track" path="tracks/:isrc" element={<TrackPage />} />,
  <Route key="releases" path="releases" element={<ReleasesPage />} />,
  <Route key="release" path="releases/:upc" element={<ReleasePage />} />,
  <Route key="artists" path="artists" element={<ArtistsPage />} />,
  <Route key="artist-duplicates" path="artists/duplicates" element={<DuplicatesPage />} />,
  <Route key="artist" path="artists/:id" element={<ArtistPage />} />,
];
