import * as env from 'yox-common/util/env'
import * as object from 'yox-common/util/object'
import { CHAR_BLANK } from 'yox-common/util/char'

export default function (source: any, keypath: string): any {
  if (source == env.NULL || keypath === CHAR_BLANK) {
    return source
  }
  else {
    const result = object.get(source, keypath)
    if (result) {
      return result.value
    }
  }
}