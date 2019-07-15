import * as constant from 'yox-type/src/constant'
import * as object from 'yox-common/src/util/object'

export default function (source: any, keypath: string): any {

  if (source == constant.NULL || keypath === constant.EMPTY_STRING) {
    return source
  }

  const result = object.get(source, keypath)
  if (result) {
    return result.value
  }

}