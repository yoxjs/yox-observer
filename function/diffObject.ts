import * as env from 'yox-common/util/env'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'

/**
 * 对比新旧对象
 *
 * @param newObject
 * @param oldObject
 * @param callback
 */
function diffObject(newObject?: Object, oldObject?: Object, callback?: (newValue: any, oldValue: any, key: string) => void) {

  let keys: string[]

  if (oldObject) {
    keys = object.keys(
      newObject ? object.extend({}, oldObject, newObject) : oldObject
    )
  }
  else if (newObject) {
    keys = object.keys(newObject)
  }

  if (keys) {
    array.each(
      keys,
      function (key) {
        callback(
          newObject ? newObject[key] : env.UNDEFINED,
          oldObject ? oldObject[key] : env.UNDEFINED,
          key
        )
      }
    )
  }
}