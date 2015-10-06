import gulp from 'gulp';
import mocha from 'gulp-spawn-mocha';
import ts from 'gulp-typescript';
import sourcemaps from 'gulp-sourcemaps';
import babel from 'gulp-babel';
import typedoc from 'gulp-typedoc';
import del from 'del';


gulp.task('clean:build', () => {
    return del(['build']);
});


gulp.task('clean:dist', () => {
    return del(['dist']);
});


gulp.task('clean:docs', () => {
    return del(['docs']);
});


gulp.task('build', ['clean:build'], () => {
    return gulp.src(['typings/tsd.d.ts', 'src/**/*.ts', 'test/**/*.ts'])
        .pipe(sourcemaps.init())
        .pipe(ts({
            target: 'ES6',
            outDir: 'build'
        }))
        .js
        .pipe(babel())
        .pipe(sourcemaps.write('.', {
            sourceRoot: process.cwd()
        }))
        .pipe(gulp.dest('build'))
    ;
});


gulp.task('test', ['build'], () => {
    return gulp.src('build/test/**/test_*.js', {read: false})
        .pipe(mocha({
            //istanbul: true,
            reporter: 'list',
            require: ['babel-core/polyfill', 'source-map-support/register']
        }));
});


gulp.task('dist', ['clean:dist'], () => {
    return gulp.src(['typings/tsd.d.ts', 'src/**/*.ts'], {base: 'src'})
        .pipe(ts({
            target: 'ES6',
            outDir: 'dist/es6'
        }))
        .js
        .pipe(gulp.dest('dist/es6'))
        .pipe(babel())
        .pipe(gulp.dest('dist/es5'))
    ;
});


gulp.task("typedoc", ['clean:docs'], () => {
    return gulp.src(['typings/tsd.d.ts', 'src/**/*.ts'])
        .pipe(typedoc({
            target: 'ES6',
            out: "./docs",

            name: "Keyper",
            version: true
        }));
});


gulp.task('default', ['build', 'test', 'dist', 'typedoc']);


gulp.task('watch', ['test'], () => {
    gulp.watch(['src/**/*.ts', 'test/**/*.ts'], ['test']);
});