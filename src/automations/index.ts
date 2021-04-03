import { merge } from 'rxjs'

import services from '../services/index'

import test from './injected/test'

export default merge(test(services))
