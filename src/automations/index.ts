import { merge } from 'rxjs'

import servicesCradle from '../services/cradle'

import workbench from './injected/workbench'

export default merge(workbench(servicesCradle))
