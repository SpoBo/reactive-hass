import { merge } from 'rxjs'

import services from '../services/index'

import workbench from './injected/workbench'

export default merge(workbench(services))
