import { NavLink } from 'react-router-dom';

/** The two pages of the Sources section. */
export function SourcesTabs() {
  return (
    <div className="tabs">
      <NavLink to="/sources" end>
        Files and checks
      </NavLink>
      <NavLink to="/sources/lines">Lines of the reports</NavLink>
    </div>
  );
}
