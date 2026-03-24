import './globals.css'
import NavigationWrapper from '../components/navigationwrapper'

export const metadata = {
  title: 'AssetTrack - IT Asset & Budget Tracker',
  description: 'Track IT assets, software licenses, and budgets',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        backgroundColor: '#0b1017',
        color: '#c0cad8',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <NavigationWrapper />
        {children}
      </body>
    </html>
  )
}
