import gulp from 'gulp';
import gutil from 'gulp-util';
import mocha from 'gulp-mocha';
import ts from 'gulp-typescript';
import babel from 'gulp-babel';
import lazypipe from 'lazypipe';

import 'babel-core/register';

gulp.task('default', () => {
  let tsResult = gulp.src('src/**/*.ts')
    .pipe(ts({
      target: 'ES6'
    }));
  return tsResult.js
    .pipe(gulp.dest('es6'))
    .pipe(babel())
    .pipe(gulp.dest('lib'));
});


gulp.task('test', function () {
  return gulp.src('test/*.js', {read: false})
    .pipe(mocha({reporter: 'list'}))
    .on('error', gutil.log);
});