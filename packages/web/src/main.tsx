import { render } from 'preact'
import '@sabaki/shudan/css/goban.css'
import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/base.css'
import './styles/board.css'
import './styles/screens.css'
import { App } from './App'

render(<App />, document.getElementById('app')!)
