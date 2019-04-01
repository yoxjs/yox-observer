import * as env from 'yox-common/util/env'
import * as object from 'yox-common/util/object'

export default function (source: any, keypath: string): any {
  if (source == env.NULL) {
    return source
  }
  else {
    let result = object.get(source, keypath)
    if (result) {
      return result.value
    }
  }
}