import { Route } from 'react-router-dom';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { TracksPage } from '../pages/catalog/TracksPage';
import { TrackPage } from '../pages/catalog/track/TrackPage';
import { ReleasesPage } from '../pages/catalog/ReleasesPage';
import { ReleasePage } from '../pages/catalog/ReleasePage';
import { ru } from '../i18n/ru';

const n = ru.nav.items;

/** Каталог: tracks and releases (step 3.6), pseudonyms (step 3.8); owners live in routes/owners.tsx. */
export const catalogRoutes = [
  <Route key="tracks" path="tracks" element={<TracksPage />} />,
  <Route key="track" path="tracks/:isrc" element={<TrackPage />} />,
  <Route key="releases" path="releases" element={<ReleasesPage />} />,
  <Route key="release" path="releases/:upc" element={<ReleasePage />} />,
  <Route key="artists" path="artists" element={<PlaceholderPage title={n.artists} step="3.8" />} />,
  <Route key="artist-duplicates" path="artists/duplicates" element={<PlaceholderPage title={n.artists} step="3.8" />} />,
  <Route key="artist" path="artists/:id" element={<PlaceholderPage title={n.artists} step="3.8" />} />,
];
