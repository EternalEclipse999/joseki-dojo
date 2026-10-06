import { render } from 'preact'
import '@sabaki/shudan/css/goban.css'
import './styles.css'
import { App } from './App'

render(<App />, document.getElementById('app')!)
