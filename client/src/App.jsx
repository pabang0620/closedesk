import OwnerPage from './owner/OwnerPage.jsx'
import DeskPage from './desk/DeskPage.jsx'

export default function App() {
  const owner = new URLSearchParams(window.location.search).get('owner')
  return owner ? <OwnerPage token={owner} /> : <DeskPage />
}
