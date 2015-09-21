import gulp from 'gulp';
import gutil from 'gulp-util';
import mocha from 'gulp-mocha';
import ts from 'gulp-typescript';
import babel from 'gulp-babel';
import lazypipe from 'lazypipe';
import typedoc from 'gulp-typedoc';

import 'babel-core/register';

let tsProject = ts.createProject('tsconfig.json');

gulp.task('default', () => {
    let tsResult = tsProject.src()
        .pipe(ts(tsProject));
    return tsResult.js
        .pipe(gulp.dest('es6'))
        .pipe(babel())
        .pipe(gulp.dest('lib'));
});


gulp.task('test', () => {
    return gulp.src('test/*.js', {read: false})
        .pipe(mocha({reporter: 'list'}))
        .on('error', gutil.log);
});


gulp.task("typedoc", () => {
    return tsProject.src()
        .pipe(typedoc(Object.assign({}, tsProject.config.compilerOptions, {
            out: "./docs",

            name: "Keyper",
            version: true
        })));
});